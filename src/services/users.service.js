import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export async function isUserActive(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  return user?.isActive ?? false;
}

export async function createUser(username, password, fullName) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    const err = new Error('Username already taken');
    err.code = 'USERNAME_TAKEN';
    throw err;
  }

  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username, password: hash, fullName, role: 'reader' },
  });

  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

export async function deactivateUser(targetId) {
  const target = await prisma.user.findUnique({ where: { id: targetId } });

  if (!target) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  if (target.role === 'admin') {
    const err = new Error('Cannot deactivate an admin user');
    err.code = 'CANNOT_DEACTIVATE_ADMIN';
    throw err;
  }

  await prisma.user.update({ where: { id: targetId }, data: { isActive: false } });
}

const SUPPORTED_LOCALES = ['en', 'pt-BR'];

export async function getMe(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    locale: user.locale,
    preferences: { locale: user.locale },
  };
}

export async function updateLocale(userId, locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    const err = new Error('Unsupported locale');
    err.code = 'UNSUPPORTED_LOCALE';
    throw err;
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { locale },
  });
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    locale: user.locale,
    preferences: { locale: user.locale },
  };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
    const err = new Error('Current password is incorrect');
    err.code = 'WRONG_PASSWORD';
    throw err;
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { password: hash } });
}
