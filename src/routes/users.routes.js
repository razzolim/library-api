import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as usersController from '../controllers/users.controller.js';

const router = Router();

router.patch('/users/me/password', authenticate, usersController.changePassword);

export default router;
