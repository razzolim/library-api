import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/books.service.js', () => ({
  listBooks: vi.fn(),
  getBookById: vi.fn(),
  createBook: vi.fn(),
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

const VALID_BOOK_BODY = {
  title: 'New Book', author: 'Author', year: 2024, genre: 'Fiction',
  isbn: '978-0000000001', coverColor: '#fff', summary: 'A book.',
};

beforeEach(() => vi.clearAllMocks());

describe('createBook controller', () => {
  it('returns 201 with the created book', async () => {
    const book = { id: 1, ...VALID_BOOK_BODY, uploadedBy: 'admin', uploadedAt: new Date() };
    booksService.createBook.mockResolvedValue(book);
    const req = { body: VALID_BOOK_BODY, user: { username: 'admin' } };
    const res = mockRes();
    await createBook(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(book);
  });

  it('passes req.user.username as uploadedBy to the service', async () => {
    booksService.createBook.mockResolvedValue({});
    const req = { body: VALID_BOOK_BODY, user: { username: 'lib-admin' } };
    await createBook(req, mockRes(), vi.fn());
    expect(booksService.createBook).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedBy: 'lib-admin' })
    );
  });

  it('returns 400 when a required field is missing', async () => {
    const res = mockRes();
    await createBook({ body: { title: 'Only title' }, user: { username: 'admin' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, errorKey: 'books.create.missingFields' });
    expect(booksService.createBook).not.toHaveBeenCalled();
  });

  it('returns 400 when body is absent', async () => {
    const res = mockRes();
    await createBook({ user: { username: 'admin' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 409 when the service throws a P2002 unique-constraint error', async () => {
    const uniqueErr = Object.assign(new Error('unique'), { code: 'P2002' });
    booksService.createBook.mockRejectedValue(uniqueErr);
    const res = mockRes();
    await createBook({ body: VALID_BOOK_BODY, user: { username: 'admin' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, errorKey: 'books.create.isbnConflict' });
  });

  it('calls next with the error for non-P2002 errors', async () => {
    booksService.createBook.mockRejectedValue(new Error('db'));
    const next = vi.fn();
    await createBook({ body: VALID_BOOK_BODY, user: { username: 'admin' } }, mockRes(), next);
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
