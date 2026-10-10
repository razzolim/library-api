import * as usersService from '../services/users.service.js';

export async function getMe(req, res, next) {
  try {
    const profile = await usersService.getMe(req.user.sub);
    return res.status(200).json(profile);
  } catch (err) {
    return next(err);
  }
}

export async function updateMe(req, res, next) {
  try {
    const { locale, readerPreferences } = req.body ?? {};
    if (!locale && readerPreferences === undefined) {
      return res.status(400).json({ success: false, errorKey: 'me.updateLocale.missingLocale' });
    }
    const profile = await usersService.updateMe(req.user.sub, { locale: locale || undefined, readerPreferences });
    // `success` + `readerPreferences` are the reader spec §4 response; the rest is the existing profile.
    return res.status(200).json(readerPreferences === undefined ? profile : { success: true, ...profile });
  } catch (err) {
    if (err.code === 'UNSUPPORTED_LOCALE') {
      return res.status(400).json({ success: false, errorKey: 'me.updateLocale.unsupportedLocale' });
    }
    if (err.code === 'INVALID_READER_PREFERENCES') {
      return res.status(400).json({ success: false, errorKey: 'reader.invalidPreferences' });
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

// The shared demo account must keep its well-known password.
const demoUsername = () => process.env.DEMO_USER_USERNAME || 'demo.user';

export async function changePassword(req, res, next) {
  try {
    if (req.user.username === demoUsername()) {
      return res
        .status(403)
        .json({ success: false, errorKey: 'users.changePassword.demoUserForbidden' });
    }

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
