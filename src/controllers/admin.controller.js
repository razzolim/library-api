import * as usersService from '../services/users.service.js';
import { requestContext } from '../lib/requestContext.js';

const MIN_PASSWORD_LENGTH = 8;

export async function resetUserPassword(req, res, next) {
  try {
    const { newPassword } = req.body ?? {};

    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ success: false, errorKey: 'admin.resetPassword.weakPassword' });
    }

    const { username } = await usersService.resetPasswordAsAdmin(
      req.user,
      req.params.username,
      newPassword,
      requestContext(req),
    );
    return res.status(200).json({ success: true, username });
  } catch (err) {
    if (err.code === 'USER_NOT_FOUND') {
      return res.status(404).json({ success: false, errorKey: 'admin.resetPassword.userNotFound' });
    }
    if (err.code === 'USE_ACCOUNT_PAGE') {
      return res.status(400).json({ success: false, errorKey: 'admin.resetPassword.useAccountPage' });
    }
    return next(err);
  }
}
