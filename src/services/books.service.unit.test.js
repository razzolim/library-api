import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = vi.hoisted(() => ({ book: { create: vi.fn() } }));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    book: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn(tx)),
  },
}));
vi.mock('./audit.service.js', () => ({ recordAudit: vi.fn() }));

import { prisma } from '../lib/prisma.js';
import { recordAudit } from './audit.service.js';
import { listBooks, getBookById, createBook, validateNewBook } from './books.service.js';

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
    expect(prisma.book.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 } }),
    );
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
  const DATA = { title: 'New Book', author: 'Author', status: 'available', coverColor: '#4a5568' };
  const ACTOR = { sub: 2, username: 'admin' };

  it('creates the book with uploadedBy taken from the actor', async () => {
    tx.book.create.mockResolvedValue({ id: 10, title: 'New Book' });
    await createBook(DATA, ACTOR);
    expect(tx.book.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ...DATA, uploadedBy: 'admin' } }),
    );
  });

  it('writes a book.create audit entry in the same transaction', async () => {
    tx.book.create.mockResolvedValue({ id: 10, title: 'New Book' });
    await createBook(DATA, ACTOR, { ip: '1.1.1.1' });
    expect(recordAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ actorUserId: 2, action: 'book.create', targetId: 10, ip: '1.1.1.1' }),
    );
  });

  it('returns the created book record', async () => {
    const created = { id: 10, title: 'New Book' };
    tx.book.create.mockResolvedValue(created);
    expect(await createBook(DATA, ACTOR)).toBe(created);
  });
});

describe('validateNewBook', () => {
  const VALID = { title: ' Refactoring ', author: 'Martin Fowler', status: 'available' };

  it('accepts the minimal body, trims text and defaults optional fields', () => {
    const { data, fields } = validateNewBook(VALID);
    expect(fields).toBeUndefined();
    expect(data).toEqual({
      title: 'Refactoring', author: 'Martin Fowler', status: 'available',
      genre: null, year: null, isbn: null, isbnNormalized: null,
      pdfUrl: null, summary: null, coverColor: '#4a5568',
    });
  });

  it('reports every missing required field', () => {
    expect(validateNewBook({}).fields).toEqual({
      title: 'required', author: 'required', status: 'required',
    });
    expect(validateNewBook(undefined).fields).toHaveProperty('title');
  });

  it.each([
    [{ title: 'x'.repeat(256) }, 'title', 'too_long'],
    [{ status: 'lost' }, 'status', 'invalid'],
    [{ genre: 'x'.repeat(101) }, 'genre', 'too_long'],
    [{ summary: 'x'.repeat(2001) }, 'summary', 'too_long'],
    [{ year: -1 }, 'year', 'out_of_range'],
    [{ year: new Date().getFullYear() + 2 }, 'year', 'out_of_range'],
    [{ year: 20.5 }, 'year', 'out_of_range'],
    [{ year: '2018' }, 'year', 'invalid_type'],
    [{ isbn: '12345' }, 'isbn', 'invalid'],
    [{ pdfUrl: 'ftp://x.org/a.pdf' }, 'pdfUrl', 'invalid'],
    [{ pdfUrl: 'not a url' }, 'pdfUrl', 'invalid'],
    [{ coverColor: 'red' }, 'coverColor', 'invalid'],
  ])('rejects %j', (override, field, code) => {
    expect(validateNewBook({ ...VALID, ...override }).fields).toEqual({ [field]: code });
  });

  it('normalizes ISBN-13 and ISBN-10 (with X) and keeps the original spelling', () => {
    expect(validateNewBook({ ...VALID, isbn: '978-0134757599' }).data)
      .toMatchObject({ isbn: '978-0134757599', isbnNormalized: '9780134757599' });
    expect(validateNewBook({ ...VALID, isbn: '0-8044-2957-x' }).data)
      .toMatchObject({ isbnNormalized: '080442957X' });
  });

  it('treats null and empty optional fields as absent', () => {
    const { data } = validateNewBook({ ...VALID, genre: '', year: null, isbn: '', pdfUrl: null, summary: null, coverColor: null });
    expect(data).toMatchObject({ genre: null, year: null, isbn: null, pdfUrl: null, summary: null, coverColor: '#4a5568' });
  });

  it('ignores client-supplied id, uploadedBy and uploadedAt', () => {
    const { data } = validateNewBook({ ...VALID, id: 5, uploadedBy: 'x', uploadedAt: '2000-01-01' });
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('uploadedBy');
    expect(data).not.toHaveProperty('uploadedAt');
  });
});
