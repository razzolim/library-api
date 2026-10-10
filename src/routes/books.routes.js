import express, { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { rateLimitPerUser } from '../middleware/rateLimit.js';
import { MAX_IMPORT_BYTES } from '../services/booksImport.service.js';
import * as booksController from '../controllers/books.controller.js';

const router = Router();

const exportLimit = rateLimitPerUser({ max: 10, windowMs: 60_000 });
const importLimit = rateLimitPerUser({ max: 10, windowMs: 60_000 });
// The CSV travels as the raw request body (Content-Type: text/csv) — no multipart parser needed.
const csvBody = express.text({ type: 'text/csv', limit: MAX_IMPORT_BYTES });

// eslint-disable-next-line no-unused-vars
function importBodyErrors(err, req, res, next) {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, errorKey: 'admin.books.import.fileTooLarge', maxBytes: MAX_IMPORT_BYTES });
  }
  return next(err);
}

router.post('/books', authenticate, requireAdmin, booksController.createBook);
router.post('/books/import', authenticate, requireAdmin, importLimit, csvBody, importBodyErrors, booksController.importBooks);
router.get('/books/export', authenticate, requireAdmin, exportLimit, booksController.exportBooks);
router.get('/books', authenticate, booksController.listBooks);
router.get('/books/:id', authenticate, booksController.getBookById);

export default router;
