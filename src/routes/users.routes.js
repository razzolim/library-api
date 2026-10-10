import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import * as usersController from '../controllers/users.controller.js';

const router = Router();

router.get('/me', authenticate, usersController.getMe);
router.patch('/me', authenticate, usersController.updateMe);

router.post('/users', authenticate, requireAdmin, usersController.createUser);
router.patch('/users/:id/deactivate', authenticate, requireAdmin, usersController.deactivateUser);
router.patch('/users/me/password', authenticate, usersController.changePassword);

export default router;
