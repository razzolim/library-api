import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { rateLimitPerUser } from '../middleware/rateLimit.js';
import * as adminController from '../controllers/admin.controller.js';

const router = Router();

router.use('/admin', authenticate, requireAdmin, rateLimitPerUser({ max: 20, windowMs: 60_000 }));

router.patch('/admin/users/:username/password', adminController.resetUserPassword);

export default router;
