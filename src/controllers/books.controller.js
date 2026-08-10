import * as booksService from '../services/books.service.js';

export async function listBooks(req, res, next) {
  try {
    const books = await booksService.listBooks();
    return res.status(200).json(books);
  } catch (err) {
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
