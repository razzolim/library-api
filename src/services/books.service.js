import { prisma } from '../lib/prisma.js';

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

export function getBookById(id) {
  if (!Number.isInteger(id)) {
    return null;
  }
  return prisma.book.findUnique({ where: { id } });
}

export function createBook({ title, author, year, genre, isbn, coverColor, summary, pdfUrl, status, uploadedBy }) {
  return prisma.book.create({
    data: {
      title,
      author,
      year,
      genre,
      isbn,
      coverColor,
      summary,
      pdfUrl: pdfUrl ?? null,
      status: status ?? 'available',
      uploadedBy,
    },
  });
}
