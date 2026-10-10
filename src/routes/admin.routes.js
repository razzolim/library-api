import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { rateLimitPerUser } from '../middleware/rateLimit.js';
import * as adminController from '../controllers/admin.controller.js';
import * as featureFlagsController from '../controllers/featureFlags.controller.js';

const router = Router();

const resetPasswordLimit = rateLimitPerUser({ max: 20, windowMs: 60_000 });
const mutationLimit = rateLimitPerUser({ max: 60, windowMs: 60_000 });

// Any signed-in user may read the flags; this must stay registered before the admin-only guard.
router.get('/admin/feature-flags', authenticate, featureFlagsController.listFlags);

router.use('/admin', authenticate, requireAdmin);

router.get('/admin/users', adminController.listUsers);
router.patch('/admin/users/:username/password', resetPasswordLimit, adminController.resetUserPassword);
router.patch('/admin/users/:username', mutationLimit, adminController.updateUser);
router.delete('/admin/users/:username', mutationLimit, adminController.deleteUser);

router.post('/admin/feature-flags', mutationLimit, featureFlagsController.createFlag);
router.patch('/admin/feature-flags/:key', mutationLimit, featureFlagsController.updateFlag);
router.delete('/admin/feature-flags/:key', mutationLimit, featureFlagsController.deleteFlag);

export default router;
