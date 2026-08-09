import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as booksController from '../controllers/books.controller.js';

const router = Router();

router.get('/books', authenticate, booksController.listBooks);
router.get('/books/:id', authenticate, booksController.getBookById);

export default router;
