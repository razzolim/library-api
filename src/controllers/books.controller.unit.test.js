import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/books.service.js', () => ({
  listBooks: vi.fn(),
  getBookById: vi.fn(),
  createBook: vi.fn(),
  validateNewBook: vi.fn(),
}));

import * as booksService from '../services/books.service.js';
import { listBooks, getBookById, createBook } from './books.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
}

const VALID_BOOK_BODY = { title: 'New Book', author: 'Author', status: 'available' };
const ACTOR = { sub: 2, username: 'admin' };

function mockReq(overrides = {}) {
  return { body: VALID_BOOK_BODY, user: ACTOR, ip: '1.1.1.1', get: vi.fn().mockReturnValue('agent'), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  booksService.validateNewBook.mockReturnValue({ data: { title: 'New Book' } });
});

describe('createBook controller', () => {
  it('returns 201 with { success, book }', async () => {
    const book = { id: 1, title: 'New Book' };
    booksService.createBook.mockResolvedValue(book);
    const res = mockRes();
    await createBook(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, book });
  });

  it('passes validated data, the acting user and request context to the service', async () => {
    booksService.createBook.mockResolvedValue({});
    await createBook(mockReq(), mockRes(), vi.fn());
    expect(booksService.createBook).toHaveBeenCalledWith(
      { title: 'New Book' }, ACTOR, { ip: '1.1.1.1', userAgent: 'agent' },
    );
  });

  it('returns 400 with field details when validation fails', async () => {
    booksService.validateNewBook.mockReturnValue({ fields: { year: 'out_of_range' } });
    const res = mockRes();
    await createBook(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false, errorKey: 'admin.books.invalidFields', fields: { year: 'out_of_range' },
    });
    expect(booksService.createBook).not.toHaveBeenCalled();
  });

  it('returns 409 when the service throws a P2002 unique-constraint error', async () => {
    booksService.createBook.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const res = mockRes();
    await createBook(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, errorKey: 'admin.books.duplicateIsbn' });
  });

  it('calls next with the error for non-P2002 errors', async () => {
    booksService.createBook.mockRejectedValue(new Error('db'));
    const next = vi.fn();
    await createBook(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('listBooks controller', () => {
  it('returns 200 with the books array from the service', async () => {
    const books = [{ id: 1 }, { id: 2 }];
    booksService.listBooks.mockResolvedValue(books);
    const res = mockRes();
    await listBooks({}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(books);
  });

  it('calls next with the error when the service throws', async () => {
    booksService.listBooks.mockRejectedValue(new Error('db'));
    const next = vi.fn();
    await listBooks({}, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('getBookById controller', () => {
  it('returns 200 with the book when found', async () => {
    const book = { id: 5, title: 'SICP' };
    booksService.getBookById.mockResolvedValue(book);
    const res = mockRes();
    await getBookById({ params: { id: '5' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(book);
  });

  it('returns 404 with an empty body when the book is not found', async () => {
    booksService.getBookById.mockResolvedValue(null);
    const res = mockRes();
    await getBookById({ params: { id: '99' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('parses the id param as a number before calling the service', async () => {
    booksService.getBookById.mockResolvedValue(null);
    await getBookById({ params: { id: '7' } }, mockRes(), vi.fn());
    expect(booksService.getBookById).toHaveBeenCalledWith(7);
  });

  it('calls next with the error when the service throws', async () => {
    booksService.getBookById.mockRejectedValue(new Error('db'));
    const next = vi.fn();
    await getBookById({ params: { id: '1' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
