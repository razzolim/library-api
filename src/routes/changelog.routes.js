import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as changelogController from '../controllers/changelog.controller.js';

const router = Router();

router.get('/changelog', authenticate, changelogController.listChangelog);

export default router;
