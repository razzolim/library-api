import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.post('/auth/login', authController.login);
router.post('/auth/logout', authenticate, authController.logout);

export default router;
