import { prisma } from '../lib/prisma.js';

export const MAX_BOOKMARKS_PER_BOOK = 200;
const MAX_NOTE_LENGTH = 500;
const MAX_PAGE = 100_000;

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

async function requireBook(bookId) {
  if (!Number.isInteger(bookId)) {
    throw coded('BOOK_NOT_FOUND');
  }
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true, pageCount: true } });
  if (!book) {
    throw coded('BOOK_NOT_FOUND');
  }
  return book;
}

// ---- Reading progress (spec §2) ------------------------------------------------------------

function toProgress(bookId, row) {
  return {
    bookId,
    page: row.page,
    totalPages: row.totalPages,
    percent: Number(row.percent),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getProgress(userId, bookId) {
  await requireBook(bookId);
  const row = await prisma.readingProgress.findUnique({ where: { userId_bookId: { userId, bookId } } });
  if (!row) {
    return { bookId, page: 1, totalPages: null, percent: 0, updatedAt: null };
  }
  return toProgress(bookId, row);
}

export function validateProgress(body) {
  const { page, totalPages } = body ?? {};
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGE) {
    return null;
  }
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    return null;
  }
  return { page, totalPages };
}

export async function saveProgress(userId, bookId, { page, totalPages }) {
  await requireBook(bookId);
  const percent = Math.round((page / totalPages) * 10000) / 100;
  const now = new Date();
  const row = await prisma.readingProgress.upsert({
    where: { userId_bookId: { userId, bookId } },
    update: { page, totalPages, percent, updatedAt: now },
    create: { userId, bookId, page, totalPages, percent, updatedAt: now, firstOpenedAt: now },
  });
  return toProgress(bookId, row);
}

export async function listReading(userId, limit) {
  const rows = await prisma.readingProgress.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: { book: { select: { id: true, title: true, author: true, coverColor: true, isbn: true } } },
  });
  return rows.map((row) => ({
    book: { ...row.book, coverUrl: null },
    page: row.page,
    totalPages: row.totalPages,
    percent: Number(row.percent),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

// ---- Bookmarks (spec §3) -------------------------------------------------------------------

function toBookmark(row) {
  return { id: row.id, page: row.page, note: row.note, createdAt: row.createdAt.toISOString() };
}

export async function listBookmarks(userId, bookId) {
  await requireBook(bookId);
  const rows = await prisma.bookmark.findMany({ where: { userId, bookId }, orderBy: { page: 'asc' } });
  return rows.map(toBookmark);
}

// Returns `{ data }` or `null` when invalid. `note` is only present in `data` when the caller sent it.
export function validateBookmark(body, pageCount) {
  const { page, note } = body ?? {};
  if (!Number.isInteger(page) || page < 1 || page > (pageCount ?? MAX_PAGE)) {
    return null;
  }
  const data = { page };
  if (note !== undefined) {
    if (note !== null && typeof note !== 'string') {
      return null;
    }
    const trimmed = note?.trim() ?? '';
    if (trimmed.length > MAX_NOTE_LENGTH) {
      return null;
    }
    data.note = trimmed === '' ? null : trimmed;
  }
  return data;
}

// Returns `{ bookmark, created }`. Bookmarking an already-bookmarked page updates its note.
export async function createBookmark(userId, bookId, body) {
  const book = await requireBook(bookId);
  const data = validateBookmark(body, book.pageCount);
  if (!data) {
    throw coded('INVALID_BOOKMARK');
  }

  const key = { userId_bookId_page: { userId, bookId, page: data.page } };
  const update = async () => {
    const existing = await prisma.bookmark.findUnique({ where: key });
    if (!existing) {
      return null;
    }
    const row = 'note' in data ? await prisma.bookmark.update({ where: key, data: { note: data.note } }) : existing;
    return { bookmark: toBookmark(row), created: false };
  };

  const existing = await update();
  if (existing) {
    return existing;
  }
  if ((await prisma.bookmark.count({ where: { userId, bookId } })) >= MAX_BOOKMARKS_PER_BOOK) {
    throw coded('BOOKMARK_LIMIT');
  }
  try {
    const row = await prisma.bookmark.create({
      data: { userId, bookId, page: data.page, note: data.note ?? null },
    });
    return { bookmark: toBookmark(row), created: true };
  } catch (err) {
    if (err.code === 'P2002') {
      // Lost a race with a concurrent request for the same page.
      return update();
    }
    throw err;
  }
}

export async function deleteBookmark(userId, bookId, bookmarkId) {
  if (!Number.isInteger(bookId) || !Number.isInteger(bookmarkId)) {
    throw coded('BOOKMARK_NOT_FOUND');
  }
  const { count } = await prisma.bookmark.deleteMany({ where: { id: bookmarkId, userId, bookId } });
  if (count === 0) {
    throw coded('BOOKMARK_NOT_FOUND');
  }
}
