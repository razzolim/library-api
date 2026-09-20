import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

export function signAccessToken(payload) {
  return jwt.sign(
    { ...payload, type: 'access', jti: randomUUID() },
    getSecret(),
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '1h' },
  );
}

export function signRefreshToken(payload, rememberMe = false) {
  const expiresIn = rememberMe
    ? (process.env.JWT_REFRESH_EXPIRES_IN_REMEMBER || '30d')
    : (process.env.JWT_REFRESH_EXPIRES_IN || '2h');
  return jwt.sign(
    { ...payload, type: 'refresh', rememberMe, jti: randomUUID() },
    getSecret(),
    { expiresIn },
  );
}

export function decodeToken(token) {
  return jwt.decode(token);
}

// Alias kept for backward compatibility — issues access tokens.
export function signToken(payload) {
  return signAccessToken(payload);
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
