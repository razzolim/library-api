import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from './audit.service.js';

// A session is valid while the account is active and the token was issued after the user's
// `sessionsValidAfter` cutoff (set when an admin resets their password). JWT `iat` has
// one-second resolution, so the cutoff is truncated to seconds and compared with `<=`.
export async function isSessionValid(userId, issuedAt) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, sessionsValidAfter: true },
  });
  if (!user?.isActive) {
    return false;
  }
  if (user.sessionsValidAfter && issuedAt <= Math.floor(user.sessionsValidAfter.getTime() / 1000)) {
    return false;
  }
  return true;
}

export async function resetPasswordAsAdmin(actor, username, newPassword, context = {}) {
  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  if (target.id === actor.sub) {
    const err = new Error('Use the account page to change your own password');
    err.code = 'USE_ACCOUNT_PAGE';
    throw err;
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { password: hash, sessionsValidAfter: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: actor.sub,
      action: 'user.password.reset',
      targetType: 'user',
      targetId: target.id,
      metadata: {},
      ...context,
    });
  });

  return { username: target.username };
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

const DEFAULT_READER_PREFERENCES = { pageTheme: 'light', zoom: 'fit-width' };
const PAGE_THEMES = ['light', 'dark'];
const ZOOM_PRESETS = ['fit-width', 'fit-page'];

// Stored value (possibly null or partial) + defaults -> the full preferences object.
export function resolveReaderPreferences(stored) {
  return { ...DEFAULT_READER_PREFERENCES, ...(stored ?? {}) };
}

// Returns the validated patch, or null for unknown keys / bad values (reader spec §4).
export function validateReaderPreferences(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'pageTheme' && PAGE_THEMES.includes(value)) {
      patch.pageTheme = value;
    } else if (
      key === 'zoom' &&
      (ZOOM_PRESETS.includes(value) || (typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 400))
    ) {
      patch.zoom = value;
    } else {
      return null;
    }
  }
  return patch;
}

function toProfile(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    locale: user.locale,
    preferences: { locale: user.locale },
    readerPreferences: resolveReaderPreferences(user.readerPreferences),
  };
}

export async function getMe(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  return toProfile(user);
}

// Applies whichever of `locale` / `readerPreferences` were sent (a partial readerPreferences is
// merged into the stored one). Everything is validated before anything is written.
export async function updateMe(userId, { locale, readerPreferences }) {
  if (locale !== undefined && !SUPPORTED_LOCALES.includes(locale)) {
    const err = new Error('Unsupported locale');
    err.code = 'UNSUPPORTED_LOCALE';
    throw err;
  }
  let patch;
  if (readerPreferences !== undefined) {
    patch = validateReaderPreferences(readerPreferences);
    if (!patch) {
      const err = new Error('Invalid reader preferences');
      err.code = 'INVALID_READER_PREFERENCES';
      throw err;
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    const data = {};
    if (locale !== undefined) {
      data.locale = locale;
    }
    if (patch) {
      const current = await tx.user.findUnique({ where: { id: userId }, select: { readerPreferences: true } });
      data.readerPreferences = { ...resolveReaderPreferences(current?.readerPreferences), ...patch };
    }
    return tx.user.update({ where: { id: userId }, data });
  });
  return toProfile(user);
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
