import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/books.service.js', () => ({
  listBooks: vi.fn(),
  getBookById: vi.fn(),
}));

import * as booksService from '../services/books.service.js';
import { listBooks, getBookById } from './books.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

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
