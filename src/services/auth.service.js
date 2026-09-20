import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyToken, decodeToken } from '../lib/jwt.js';

export async function login(username, password, rememberMe = false) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return null;
  }

  if (!user.isActive) {
    const err = new Error('Account is deactivated');
    err.code = 'ACCOUNT_DEACTIVATED';
    throw err;
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    return null;
  }

  const claims = { sub: user.id, username: user.username, role: user.role };
  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken(claims, rememberMe);
  const { exp } = decodeToken(accessToken);

  return {
    accessToken,
    refreshToken,
    expiresIn: exp - Math.floor(Date.now() / 1000),
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      locale: user.locale,
    },
  };
}

export async function revokeToken(jti, exp) {
  await prisma.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.revokedToken.upsert({
    where: { jti },
    update: {},
    create: { jti, expiresAt: new Date(exp * 1000) },
  });
}

export async function isTokenRevoked(jti) {
  const revoked = await prisma.revokedToken.findUnique({ where: { jti } });
  return revoked !== null;
}

export async function refreshAccessToken(rawRefreshToken) {
  let payload;
  try {
    payload = verifyToken(rawRefreshToken);
  } catch {
    const err = new Error('Invalid refresh token');
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  if (payload.type !== 'refresh') {
    const err = new Error('Not a refresh token');
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  if (await isTokenRevoked(payload.jti)) {
    const err = new Error('Refresh token revoked');
    err.code = 'INVALID_REFRESH_TOKEN';
    throw err;
  }

  await revokeToken(payload.jti, payload.exp);

  const claims = { sub: payload.sub, username: payload.username, role: payload.role };
  const newAccessToken = signAccessToken(claims);
  const newRefreshToken = signRefreshToken(claims, payload.rememberMe || false);
  const { exp } = decodeToken(newAccessToken);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: exp - Math.floor(Date.now() / 1000),
  };
}

export async function revokeRefreshToken(rawRefreshToken) {
  let payload;
  try {
    payload = verifyToken(rawRefreshToken);
  } catch {
    return;
  }
  if (payload.type !== 'refresh') {
    return;
  }
  await revokeToken(payload.jti, payload.exp);
}
