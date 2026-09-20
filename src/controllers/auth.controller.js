import * as authService from '../services/auth.service.js';

export async function login(req, res, next) {
  try {
    const { username, password, rememberMe = false } = req.body ?? {};

    if (!username || !password) {
      return res.status(401).json({ success: false, errorKey: 'login.invalidCredentials' });
    }

    const result = await authService.login(username, password, Boolean(rememberMe));

    if (!result) {
      return res.status(401).json({ success: false, errorKey: 'login.invalidCredentials' });
    }

    return res.status(200).json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    });
  } catch (err) {
    if (err.code === 'ACCOUNT_DEACTIVATED') {
      return res.status(401).json({ success: false, errorKey: 'login.accountDeactivated' });
    }
    return next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const { jti, exp } = req.user;
    const { refreshToken } = req.body ?? {};

    await authService.revokeToken(jti, exp);

    if (refreshToken) {
      await authService.revokeRefreshToken(refreshToken);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body ?? {};

    if (!refreshToken) {
      return res.status(401).json({ success: false, errorKey: 'auth.refresh.missingToken' });
    }

    const result = await authService.refreshAccessToken(refreshToken);

    return res.status(200).json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    });
  } catch (err) {
    if (err.code === 'INVALID_REFRESH_TOKEN') {
      return res.status(401).json({ success: false, errorKey: 'auth.refresh.invalidToken' });
    }
    return next(err);
  }
}
