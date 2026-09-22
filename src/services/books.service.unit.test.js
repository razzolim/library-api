import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    book: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';
import { listBooks, getBookById, createBook } from './books.service.js';

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
    expect(select).toHaveProperty('uploadedBy', true);
    expect(select).toHaveProperty('uploadedAt', true);
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

describe('createBook', () => {
  const INPUT = {
    title: 'New Book', author: 'Author', year: 2024, genre: 'Fiction',
    isbn: '978-0000000001', coverColor: '#fff', summary: 'A book.',
    pdfUrl: null, status: 'available', uploadedBy: 'admin',
  };

  it('calls prisma.book.create with the provided data', async () => {
    prisma.book.create.mockResolvedValue({ id: 10, ...INPUT, uploadedAt: new Date() });
    await createBook(INPUT);
    expect(prisma.book.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ uploadedBy: 'admin', title: 'New Book' }) })
    );
  });

  it('defaults status to available when not provided', async () => {
    prisma.book.create.mockResolvedValue({});
    await createBook({ ...INPUT, status: undefined });
    const { data } = prisma.book.create.mock.calls[0][0];
    expect(data.status).toBe('available');
  });

  it('defaults pdfUrl to null when not provided', async () => {
    prisma.book.create.mockResolvedValue({});
    await createBook({ ...INPUT, pdfUrl: undefined });
    const { data } = prisma.book.create.mock.calls[0][0];
    expect(data.pdfUrl).toBeNull();
  });

  it('returns the created book record', async () => {
    const created = { id: 10, ...INPUT, uploadedAt: new Date() };
    prisma.book.create.mockResolvedValue(created);
    expect(await createBook(INPUT)).toBe(created);
  });
});
