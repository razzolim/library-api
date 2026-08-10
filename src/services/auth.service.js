import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';

export async function login(username, password) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    return null;
  }

  const token = signToken({ sub: user.id, username: user.username, role: user.role });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    },
  };
}

export async function revokeToken(jti, exp) {
  // Prune tokens that have already expired naturally — their `jti` would fail
  // verifyToken() anyway, so keeping them around only grows the table.
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
