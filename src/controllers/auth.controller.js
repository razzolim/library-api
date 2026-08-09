import * as authService from '../services/auth.service.js';

export async function login(req, res, next) {
  try {
    const { username, password } = req.body ?? {};

    if (!username || !password) {
      return res.status(401).json({ success: false, errorKey: 'login.invalidCredentials' });
    }

    const result = await authService.login(username, password);

    if (!result) {
      return res.status(401).json({ success: false, errorKey: 'login.invalidCredentials' });
    }

    return res.status(200).json({ success: true, user: result.user, token: result.token });
  } catch (err) {
    return next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const { jti, exp } = req.user;
    await authService.revokeToken(jti, exp);
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
}
