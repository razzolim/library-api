import * as usersService from '../services/users.service.js';

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ success: false, errorKey: 'users.changePassword.missingFields' });
    }

    await usersService.changePassword(req.user.sub, currentPassword, newPassword);

    return res.status(200).json({ success: true });
  } catch (err) {
    if (err.code === 'WRONG_PASSWORD') {
      return res
        .status(401)
        .json({ success: false, errorKey: 'users.changePassword.wrongCurrentPassword' });
    }
    return next(err);
  }
}
