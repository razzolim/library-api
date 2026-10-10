import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { rateLimitPerUser } from '../middleware/rateLimit.js';
import * as pdfController from '../controllers/pdf.controller.js';
import * as readerController from '../controllers/reader.controller.js';

const router = Router();

const limit = (max) => rateLimitPerUser({ max, windowMs: 60_000, errorKey: 'reader.rateLimited' });
const pdfLimit = limit(60);
const progressWriteLimit = limit(30);

router.get('/books/:id/pdf', authenticate, pdfLimit, pdfController.streamPdf);

router.get('/books/:id/progress', authenticate, readerController.getProgress);
router.put('/books/:id/progress', authenticate, progressWriteLimit, readerController.saveProgress);
router.get('/me/reading', authenticate, readerController.listReading);

router.get('/books/:id/bookmarks', authenticate, readerController.listBookmarks);
router.post('/books/:id/bookmarks', authenticate, readerController.createBookmark);
router.delete('/books/:id/bookmarks/:bookmarkId', authenticate, readerController.deleteBookmark);

export default router;
