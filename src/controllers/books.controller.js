import * as booksService from '../services/books.service.js';
import { requestContext } from '../lib/requestContext.js';

export async function listBooks(req, res, next) {
  try {
    const books = await booksService.listBooks();
    return res.status(200).json(books);
  } catch (err) {
    return next(err);
  }
}

export async function createBook(req, res, next) {
  try {
    const { data, fields } = booksService.validateNewBook(req.body);
    if (fields) {
      return res.status(400).json({ success: false, errorKey: 'admin.books.invalidFields', fields });
    }
    const book = await booksService.createBook(data, req.user, requestContext(req));
    return res.status(201).json({ success: true, book });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, errorKey: 'admin.books.duplicateIsbn' });
    }
    return next(err);
  }
}

export async function getBookById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const book = await booksService.getBookById(id);

    if (!book) {
      return res.status(404).end();
    }

    return res.status(200).json(book);
  } catch (err) {
    return next(err);
  }
}
