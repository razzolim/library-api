import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from './audit.service.js';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

// The only user shape that leaves the admin API — never the password hash or token cutoffs.
function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email ?? null,
    role: user.role,
    enabled: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export function parseListParams({ page, pageSize, query } = {}) {
  const parsedPage = Number.parseInt(page, 10);
  const parsedSize = Number.parseInt(pageSize, 10);
  return {
    page: Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
    pageSize: Number.isFinite(parsedSize) && parsedSize >= 1
      ? Math.min(parsedSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE,
    query: typeof query === 'string' ? query.trim() : '',
  };
}

export async function listUsers(params) {
  const { page, pageSize, query } = parseListParams(params);

  // Raw SQL because Prisma cannot order by LOWER(full_name). `%`, `_` and `\` in the search
  // text are escaped so they match literally.
  let where = Prisma.empty;
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    where = Prisma.sql`WHERE username ILIKE ${pattern} ESCAPE '\\'
      OR full_name ILIKE ${pattern} ESCAPE '\\'
      OR email ILIKE ${pattern} ESCAPE '\\'`;
  }

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, username, full_name AS "fullName", email, role, is_active AS "enabled",
             last_login_at AS "lastLoginAt"
      FROM "user" ${where}
      ORDER BY LOWER(full_name), id
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw`SELECT COUNT(*) AS total FROM "user" ${where}`,
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      email: row.email ?? null,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    })),
    total: Number(countRows[0].total),
    page,
    pageSize,
  };
}

// Returns `{ data }` or `{ errorCode }` for a PATCH /admin/users/:username body.
export function validateUserUpdate(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errorCode: 'INVALID_FIELDS' };
  }
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((key) => key !== 'email' && key !== 'enabled')) {
    return { errorCode: 'INVALID_FIELDS' };
  }

  const data = {};
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return { errorCode: 'INVALID_FIELDS' };
    }
    data.enabled = body.enabled;
  }
  if ('email' in body) {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (email === '' || email.length > 255 || !EMAIL_PATTERN.test(email)) {
      return { errorCode: 'INVALID_EMAIL' };
    }
    data.email = email;
  }
  return { data };
}

// Locks every enabled admin row for the rest of the transaction, so two admins cannot
// disable/delete each other concurrently, then throws LAST_ADMIN if `target` is an enabled
// admin and no other enabled admin exists.
async function assertNotLastAdmin(tx, target) {
  const admins = await tx.$queryRaw`
    SELECT id FROM "user" WHERE role = 'admin' AND is_active = true FOR UPDATE`;
  if (target.role === 'admin' && target.isActive && !admins.some((a) => a.id !== target.id)) {
    throw fail('LAST_ADMIN');
  }
}

async function loadTarget(tx, username) {
  const target = await tx.user.findUnique({ where: { username } });
  if (!target) {
    throw fail('USER_NOT_FOUND');
  }
  return target;
}

export async function updateUser(actor, username, data, context = {}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const audit = (action, metadata, targetId) =>
        recordAudit(tx, {
          actorUserId: actor.sub, action, targetType: 'user', targetId, metadata, ...context,
        });

      // Lock before reading the target so the last-admin check sees consistent state.
      if (data.enabled === false) {
        await tx.$queryRaw`SELECT id FROM "user" WHERE role = 'admin' AND is_active = true FOR UPDATE`;
      }
      let target = await loadTarget(tx, username);
      const changes = {};

      if (data.enabled !== undefined && data.enabled !== target.isActive) {
        if (data.enabled === false) {
          if (target.id === actor.sub) {
            throw fail('CANNOT_MODIFY_SELF');
          }
          await assertNotLastAdmin(tx, target);
          // The cutoff also keeps old tokens dead if the account is re-enabled later.
          changes.isActive = false;
          changes.sessionsValidAfter = new Date();
        } else {
          changes.isActive = true;
        }
      } else if (data.enabled === false && target.id === actor.sub) {
        throw fail('CANNOT_MODIFY_SELF');
      }

      const emailChanged = data.email !== undefined && data.email !== target.email;
      if (emailChanged) {
        const clash = await tx.user.findFirst({
          where: { email: { equals: data.email, mode: 'insensitive' }, NOT: { id: target.id } },
          select: { id: true },
        });
        if (clash) {
          throw fail('DUPLICATE_EMAIL');
        }
        changes.email = data.email;
      }

      if (Object.keys(changes).length > 0) {
        const previousEmail = target.email;
        target = await tx.user.update({ where: { id: target.id }, data: changes });
        if (emailChanged) {
          await audit('user.email.update', { from: previousEmail, to: data.email }, target.id);
        }
        if ('isActive' in changes) {
          await audit(changes.isActive ? 'user.enable' : 'user.disable', {}, target.id);
        }
      }

      return toPublicUser(target);
    });
  } catch (err) {
    // The LOWER(email) unique index is the final guard against a concurrent duplicate.
    if (err.code === 'P2002') {
      throw fail('DUPLICATE_EMAIL');
    }
    throw err;
  }
}

// Hard delete: books keep `uploaded_by` as a plain username string and audit_log has no FK to
// user, so nothing referencing the row breaks. Existing tokens die because the user no longer
// exists (see isSessionValid), and the audit entry keeps the username.
export async function deleteUser(actor, username, context = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "user" WHERE role = 'admin' AND is_active = true FOR UPDATE`;
    const target = await loadTarget(tx, username);
    if (target.id === actor.sub) {
      throw fail('CANNOT_MODIFY_SELF');
    }
    await assertNotLastAdmin(tx, target);
    await tx.user.delete({ where: { id: target.id } });
    await recordAudit(tx, {
      actorUserId: actor.sub,
      action: 'user.delete',
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username },
      ...context,
    });
  });
}
