import { prisma } from '../lib/prisma.js';
import { recordAudit } from './audit.service.js';

const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const MAX_DESCRIPTION_LENGTH = 255;

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function toPublicFlag(flag) {
  return {
    key: flag.key,
    description: flag.description,
    enabled: flag.enabled,
    updatedAt: flag.updatedAt.toISOString(),
    updatedBy: flag.updatedBy ?? null,
  };
}

// Returns `{ data }` or `{ errorCode }` for a POST /admin/feature-flags body.
export function validateNewFlag(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errorCode: 'INVALID_KEY' };
  }
  if (typeof body.key !== 'string' || !KEY_PATTERN.test(body.key)) {
    return { errorCode: 'INVALID_KEY' };
  }
  const description = body.description ?? '';
  if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH) {
    return { errorCode: 'INVALID_FIELDS' };
  }
  const enabled = body.enabled ?? false;
  if (typeof enabled !== 'boolean') {
    return { errorCode: 'INVALID_FIELDS' };
  }
  return { data: { key: body.key, description, enabled } };
}

// Returns `{ data }` or `{ errorCode }` for a PATCH /admin/feature-flags/:key body.
export function validateFlagToggle(body) {
  if (body === null || typeof body !== 'object' || typeof body.enabled !== 'boolean') {
    return { errorCode: 'INVALID_FIELDS' };
  }
  return { data: { enabled: body.enabled } };
}

export async function listFlags() {
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  return { items: flags.map(toPublicFlag) };
}

export async function createFlag(actor, data, context = {}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({ data: { ...data, updatedBy: actor.username } });
      await recordAudit(tx, {
        actorUserId: actor.sub,
        action: 'admin.feature_flag.created',
        targetType: 'feature_flag',
        targetId: flag.key,
        metadata: { enabled: flag.enabled },
        ...context,
      });
      return toPublicFlag(flag);
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw fail('DUPLICATE_KEY');
    }
    throw err;
  }
}

export async function setFlagEnabled(actor, key, enabled, context = {}) {
  return prisma.$transaction(async (tx) => {
    // Row lock so the changed/unchanged decision (and the audit entry) can't race.
    const rows = await tx.$queryRaw`SELECT key FROM "feature_flag" WHERE key = ${key} FOR UPDATE`;
    if (rows.length === 0) {
      throw fail('NOT_FOUND');
    }
    const current = await tx.featureFlag.findUnique({ where: { key } });
    if (current.enabled === enabled) {
      return toPublicFlag(current);
    }
    const flag = await tx.featureFlag.update({
      where: { key },
      data: { enabled, updatedAt: new Date(), updatedBy: actor.username },
    });
    await recordAudit(tx, {
      actorUserId: actor.sub,
      action: 'admin.feature_flag.toggled',
      targetType: 'feature_flag',
      targetId: key,
      metadata: { enabled },
      ...context,
    });
    return toPublicFlag(flag);
  });
}

export async function deleteFlag(actor, key, context = {}) {
  await prisma.$transaction(async (tx) => {
    const flag = await tx.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw fail('NOT_FOUND');
    }
    // deleteMany: a concurrent delete between the read and here must not surface as a 500.
    const { count } = await tx.featureFlag.deleteMany({ where: { key } });
    if (count === 0) {
      throw fail('NOT_FOUND');
    }
    await recordAudit(tx, {
      actorUserId: actor.sub,
      action: 'admin.feature_flag.deleted',
      targetType: 'feature_flag',
      targetId: key,
      metadata: { enabled: flag.enabled },
      ...context,
    });
  });
}
