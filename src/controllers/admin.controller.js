import * as usersService from '../services/users.service.js';
import * as adminUsersService from '../services/adminUsers.service.js';
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

const USER_ERRORS = {
  USER_NOT_FOUND: [404, 'admin.users.notFound'],
  INVALID_EMAIL: [400, 'admin.users.invalidEmail'],
  INVALID_FIELDS: [400, 'admin.users.invalidFields'],
  DUPLICATE_EMAIL: [409, 'admin.users.duplicateEmail'],
  CANNOT_MODIFY_SELF: [409, 'admin.users.cannotModifySelf'],
  LAST_ADMIN: [409, 'admin.users.lastAdmin'],
};

function sendUserError(err, res, next) {
  const mapped = USER_ERRORS[err.code];
  if (!mapped) {
    return next(err);
  }
  return res.status(mapped[0]).json({ success: false, errorKey: mapped[1] });
}

export async function listUsers(req, res, next) {
  try {
    return res.status(200).json(await adminUsersService.listUsers(req.query));
  } catch (err) {
    return next(err);
  }
}

export async function updateUser(req, res, next) {
  try {
    const { data, errorCode } = adminUsersService.validateUserUpdate(req.body);
    if (errorCode) {
      return sendUserError({ code: errorCode }, res, next);
    }
    const user = await adminUsersService.updateUser(req.user, req.params.username, data, requestContext(req));
    return res.status(200).json({ success: true, user });
  } catch (err) {
    return sendUserError(err, res, next);
  }
}

export async function deleteUser(req, res, next) {
  try {
    await adminUsersService.deleteUser(req.user, req.params.username, requestContext(req));
    return res.status(200).json({ success: true });
  } catch (err) {
    return sendUserError(err, res, next);
  }
}
