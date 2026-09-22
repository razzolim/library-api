import * as booksService from '../services/books.service.js';

const REQUIRED_BOOK_FIELDS = ['title', 'author', 'year', 'genre', 'isbn', 'coverColor', 'summary'];

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
    const { title, author, year, genre, isbn, coverColor, summary, pdfUrl, status } = req.body ?? {};
    const missing = REQUIRED_BOOK_FIELDS.some((f) => req.body?.[f] == null || req.body[f] === '');
    if (missing) {
      return res.status(400).json({ success: false, errorKey: 'books.create.missingFields' });
    }
    const book = await booksService.createBook({
      title, author, year, genre, isbn, coverColor, summary, pdfUrl, status,
      uploadedBy: req.user.username,
    });
    return res.status(201).json(book);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, errorKey: 'books.create.isbnConflict' });
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
