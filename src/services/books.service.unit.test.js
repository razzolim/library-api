import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    book: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';
import { listBooks, getBookById } from './books.service.js';

beforeEach(() => vi.clearAllMocks());

describe('listBooks', () => {
  it('queries books ordered by id ascending with only the list fields', async () => {
    prisma.book.findMany.mockResolvedValue([]);
    await listBooks();
    expect(prisma.book.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' } })
    );
    const { select } = prisma.book.findMany.mock.calls[0][0];
    expect(select).not.toHaveProperty('summary');
    expect(select).not.toHaveProperty('pdfUrl');
    expect(select).toHaveProperty('id', true);
    expect(select).toHaveProperty('title', true);
  });

  it('returns whatever the database returns', async () => {
    const rows = [{ id: 1, title: 'Clean Code' }];
    prisma.book.findMany.mockResolvedValue(rows);
    expect(await listBooks()).toBe(rows);
  });
});

describe('getBookById', () => {
  it('returns null immediately for a non-integer id', async () => {
    expect(await getBookById(1.5)).toBeNull();
    expect(await getBookById(NaN)).toBeNull();
    expect(prisma.book.findUnique).not.toHaveBeenCalled();
  });

  it('calls findUnique with the given integer id', async () => {
    prisma.book.findUnique.mockResolvedValue({ id: 3 });
    await getBookById(3);
    expect(prisma.book.findUnique).toHaveBeenCalledWith({ where: { id: 3 } });
  });

  it('returns null when the book does not exist', async () => {
    prisma.book.findUnique.mockResolvedValue(null);
    expect(await getBookById(99)).toBeNull();
  });

  it('returns the book record when found', async () => {
    const book = { id: 1, title: 'Clean Code', summary: '...', pdfUrl: null };
    prisma.book.findUnique.mockResolvedValue(book);
    expect(await getBookById(1)).toBe(book);
  });
});
