import * as usersService from '../services/users.service.js';

export async function getMe(req, res, next) {
  try {
    const profile = await usersService.getMe(req.user.sub);
    return res.status(200).json(profile);
  } catch (err) {
    return next(err);
  }
}

export async function updateLocale(req, res, next) {
  try {
    const { locale } = req.body ?? {};
    if (!locale) {
      return res.status(400).json({ success: false, errorKey: 'me.updateLocale.missingLocale' });
    }
    const profile = await usersService.updateLocale(req.user.sub, locale);
    return res.status(200).json(profile);
  } catch (err) {
    if (err.code === 'UNSUPPORTED_LOCALE') {
      return res.status(400).json({ success: false, errorKey: 'me.updateLocale.unsupportedLocale' });
    }
    return next(err);
  }
}

export async function createUser(req, res, next) {
  try {
    const { username, password, fullName } = req.body ?? {};

    if (!username || !password || !fullName) {
      return res
        .status(400)
        .json({ success: false, errorKey: 'users.createUser.missingFields' });
    }

    const user = await usersService.createUser(username, password, fullName);
    return res.status(201).json({ success: true, user });
  } catch (err) {
    if (err.code === 'USERNAME_TAKEN') {
      return res
        .status(409)
        .json({ success: false, errorKey: 'users.createUser.usernameTaken' });
    }
    return next(err);
  }
}

export async function deactivateUser(req, res, next) {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(404).json({ success: false, errorKey: 'users.deactivateUser.notFound' });
    }

    await usersService.deactivateUser(targetId);
    return res.status(200).json({ success: true });
  } catch (err) {
    if (err.code === 'USER_NOT_FOUND') {
      return res
        .status(404)
        .json({ success: false, errorKey: 'users.deactivateUser.notFound' });
    }
    if (err.code === 'CANNOT_DEACTIVATE_ADMIN') {
      return res
        .status(403)
        .json({ success: false, errorKey: 'users.deactivateUser.cannotDeactivateAdmin' });
    }
    return next(err);
  }
}

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
