import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const NAMES = ['ff-admin', 'ff-reader'];
const BASE = '/api/admin/feature-flags';

let adminToken;
let readerToken;
let adminId;

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function login(username) {
  const res = await request(app).post('/api/auth/login').send({ username, password: 'pass-1234' });
  return res.body.accessToken;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  const password = await bcrypt.hash('pass-1234', 4);
  await prisma.user.create({ data: { username: 'ff-admin', fullName: 'FF Admin', role: 'admin', password } });
  await prisma.user.create({ data: { username: 'ff-reader', fullName: 'FF Reader', role: 'reader', password } });
  adminId = (await prisma.user.findUnique({ where: { username: 'ff-admin' } })).id;
  adminToken = await login('ff-admin');
  readerToken = await login('ff-reader');
  await prisma.featureFlag.deleteMany();
});

afterAll(async () => {
  await prisma.featureFlag.deleteMany();
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
  await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  await prisma.$disconnect();
});

describe('authorization', () => {
  it.each([
    ['post', BASE],
    ['patch', `${BASE}/x`],
    ['delete', `${BASE}/x`],
  ])('%s %s returns 403 admin.forbidden for a reader', async (method, path) => {
    const res = await request(app)[method](path).set(auth(readerToken)).send({});
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorKey: 'admin.forbidden' });
  });
});

describe('GET access', () => {
  it('lets a non-admin list flags', async () => {
    const res = await request(app).get(BASE).set(auth(readerToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('still requires a valid token', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });
});

describe('feature flag lifecycle', () => {
  it('creates a flag with defaults', async () => {
    const res = await request(app).post(BASE).set(auth(adminToken)).send({ key: 'beta-reader' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.flag).toMatchObject({
      key: 'beta-reader', description: '', enabled: false, updatedBy: 'ff-admin',
    });
    expect(new Date(res.body.flag.updatedAt).toISOString()).toBe(res.body.flag.updatedAt);
  });

  it('rejects a duplicate key with 409', async () => {
    const res = await request(app).post(BASE).set(auth(adminToken)).send({ key: 'beta-reader' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, errorKey: 'admin.featureFlags.duplicateKey' });
  });

  it.each(['A', 'a', '1abc', 'Has-Upper', 'has space', 'x'.repeat(65), undefined, 42])(
    'rejects invalid key %j with 422',
    async (key) => {
      const res = await request(app).post(BASE).set(auth(adminToken)).send({ key });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ success: false, errorKey: 'admin.featureFlags.invalidKey' });
    },
  );

  it('rejects a too-long description or non-boolean enabled with 422', async () => {
    for (const body of [
      { key: 'bad-one', description: 'x'.repeat(256) },
      { key: 'bad-two', enabled: 'yes' },
    ]) {
      const res = await request(app).post(BASE).set(auth(adminToken)).send(body);
      expect(res.status).toBe(422);
    }
    expect(await prisma.featureFlag.count({ where: { key: { in: ['bad-one', 'bad-two'] } } })).toBe(0);
  });

  it('lists flags sorted by key', async () => {
    await request(app).post(BASE).set(auth(adminToken))
      .send({ key: 'alpha-flag', description: 'First', enabled: true });
    const res = await request(app).get(BASE).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.items.map((f) => f.key)).toEqual(['alpha-flag', 'beta-reader']);
    expect(res.body.items[0]).toMatchObject({ description: 'First', enabled: true });
  });

  it('toggles a flag and audits only real changes', async () => {
    const res = await request(app).patch(`${BASE}/beta-reader`).set(auth(adminToken)).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.flag).toMatchObject({ key: 'beta-reader', enabled: true, updatedBy: 'ff-admin' });

    await request(app).patch(`${BASE}/beta-reader`).set(auth(adminToken)).send({ enabled: true });
    const toggles = await prisma.auditLog.findMany({
      where: { action: 'admin.feature_flag.toggled', targetId: 'beta-reader' },
    });
    expect(toggles).toHaveLength(1);
    expect(toggles[0].metadata).toEqual({ enabled: true });
  });

  it('rejects a non-boolean enabled with 422 and an unknown key with 404', async () => {
    const bad = await request(app).patch(`${BASE}/beta-reader`).set(auth(adminToken)).send({ enabled: 'on' });
    expect(bad.status).toBe(422);
    const missing = await request(app).patch(`${BASE}/nope`).set(auth(adminToken)).send({ enabled: true });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, errorKey: 'admin.featureFlags.notFound' });
  });

  it('deletes a flag, then 404s', async () => {
    const res = await request(app).delete(`${BASE}/beta-reader`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const again = await request(app).delete(`${BASE}/beta-reader`).set(auth(adminToken));
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ success: false, errorKey: 'admin.featureFlags.notFound' });
  });

  it('wrote created, toggled and deleted audit entries with the key as target_id', async () => {
    const entries = await prisma.auditLog.findMany({
      where: { targetType: 'feature_flag', targetId: 'beta-reader', actorUserId: adminId },
    });
    expect(entries.map((e) => e.action).sort()).toEqual([
      'admin.feature_flag.created',
      'admin.feature_flag.deleted',
      'admin.feature_flag.toggled',
    ]);
  });
});
