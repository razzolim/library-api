import { prisma } from '../lib/prisma.js';
import { recordAudit } from './audit.service.js';

// Keeps the list payload matching backend-api-specification.md 3.1 exactly —
// `summary` is only returned by the detail endpoint (see getBookById below).
const LIST_FIELDS = {
  id: true,
  title: true,
  author: true,
  year: true,
  genre: true,
  status: true,
  isbn: true,
  coverColor: true,
  uploadedBy: true,
  uploadedAt: true,
};

export function listBooks() {
  return prisma.book.findMany({ orderBy: { id: 'asc' }, select: LIST_FIELDS });
}

const DETAIL_FIELDS = { ...LIST_FIELDS, summary: true, pdfUrl: true };

export function getBookById(id) {
  if (!Number.isInteger(id)) {
    return null;
  }
  return prisma.book.findUnique({ where: { id }, select: DETAIL_FIELDS });
}

const DEFAULT_COVER_COLOR = '#4a5568';
const BOOK_STATUSES = ['available', 'borrowed'];

function optionalText(value, maxLength, fields, name) {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    fields[name] = 'invalid_type';
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.length > maxLength) {
    fields[name] = 'too_long';
    return null;
  }
  return trimmed;
}

function requiredText(value, maxLength, fields, name) {
  if (typeof value !== 'string') {
    fields[name] = value == null ? 'required' : 'invalid_type';
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    fields[name] = 'required';
  } else if (trimmed.length > maxLength) {
    fields[name] = 'too_long';
  }
  return trimmed;
}

// Validates and normalizes a POST /books body (admin spec §3). Returns `{ fields }` with
// per-field error codes when invalid, otherwise `{ data }` ready for Prisma.
export function validateNewBook(body) {
  const input = body ?? {};
  const fields = {};

  const title = requiredText(input.title, 255, fields, 'title');
  const author = requiredText(input.author, 255, fields, 'author');

  let status = input.status;
  if (status == null) {
    fields.status = 'required';
  } else if (!BOOK_STATUSES.includes(status)) {
    fields.status = 'invalid';
  }

  const genre = optionalText(input.genre, 100, fields, 'genre');
  const summary = optionalText(input.summary, 2000, fields, 'summary');

  let year = input.year ?? null;
  if (year !== null && (!Number.isInteger(year) || year < 0 || year > new Date().getFullYear() + 1)) {
    fields.year = typeof year === 'number' ? 'out_of_range' : 'invalid_type';
    year = null;
  }

  let isbn = null;
  let isbnNormalized = null;
  if (input.isbn != null && String(input.isbn).trim() !== '') {
    const raw = typeof input.isbn === 'string' ? input.isbn.trim() : null;
    const digits = raw?.replace(/-/g, '').toUpperCase();
    if (raw && (/^\d{13}$/.test(digits) || /^\d{9}[\dX]$/.test(digits))) {
      isbn = raw;
      isbnNormalized = digits;
    } else {
      fields.isbn = 'invalid';
    }
  }

  let pdfUrl = null;
  if (input.pdfUrl != null && input.pdfUrl !== '') {
    try {
      const url = typeof input.pdfUrl === 'string' ? new URL(input.pdfUrl) : null;
      if (url && ['http:', 'https:'].includes(url.protocol) && input.pdfUrl.length <= 2048) {
        pdfUrl = input.pdfUrl;
      } else {
        fields.pdfUrl = 'invalid';
      }
    } catch {
      fields.pdfUrl = 'invalid';
    }
  }

  let coverColor = DEFAULT_COVER_COLOR;
  if (input.coverColor != null) {
    if (typeof input.coverColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.coverColor)) {
      coverColor = input.coverColor;
    } else {
      fields.coverColor = 'invalid';
    }
  }

  if (Object.keys(fields).length > 0) {
    return { fields };
  }
  return { data: { title, author, status, genre, year, isbn, isbnNormalized, pdfUrl, summary, coverColor } };
}

export async function createBook(data, actor, context = {}) {
  return prisma.$transaction(async (tx) => {
    const book = await tx.book.create({
      data: { ...data, uploadedBy: actor.username },
      select: DETAIL_FIELDS,
    });
    await recordAudit(tx, {
      actorUserId: actor.sub,
      action: 'book.create',
      targetType: 'book',
      targetId: book.id,
      metadata: { title: book.title },
      ...context,
    });
    return book;
  });
}
