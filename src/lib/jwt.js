import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

export function signToken(payload) {
  return jwt.sign({ ...payload, jti: randomUUID() }, getSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
