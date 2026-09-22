import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import * as booksController from '../controllers/books.controller.js';

const router = Router();

router.post('/books', authenticate, requireAdmin, booksController.createBook);
router.get('/books', authenticate, booksController.listBooks);
router.get('/books/:id', authenticate, booksController.getBookById);

export default router;
