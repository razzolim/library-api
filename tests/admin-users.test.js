import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const NAMES = ['au-admin', 'au-admin2', 'au-alice', 'au-bob', 'au-carol'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let adminToken;
let readerToken;
let adminId;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const url = (u) => `/api/admin/users/${encodeURIComponent(u)}`;

async function login(username) {
  const res = await request(app).post('/api/auth/login').send({ username, password: 'pass-1234' });
  return res.body;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  const password = await bcrypt.hash('pass-1234', 4);
  const rows = [
    ['au-admin', 'Zed Admin', 'admin', null],
    ['au-admin2', 'Yan Admin', 'admin', null],
    ['au-alice', 'Alice Au', 'reader', 'alice@au.test'],
    ['au-bob', 'bob Au', 'reader', 'bob@au.test'],
    ['au-carol', 'Carol 100%', 'reader', null],
  ];
  for (const [username, fullName, role, email] of rows) {
    await prisma.user.create({ data: { username, fullName, role, email, password } });
  }
  adminId = (await prisma.user.findUnique({ where: { username: 'au-admin' } })).id;
  adminToken = (await login('au-admin')).accessToken;
  readerToken = (await login('au-alice')).accessToken;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
  await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  await prisma.$disconnect();
});

describe('authorization', () => {
  it.each([
    ['get', '/api/admin/users'],
    ['patch', url('au-bob')],
    ['delete', url('au-bob')],
  ])('%s %s returns 403 admin.forbidden for a reader', async (method, path) => {
    const res = await request(app)[method](path).set(auth(readerToken)).send({ enabled: false });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorKey: 'admin.forbidden' });
  });
});

describe('GET /api/admin/users', () => {
  it('returns the public shape, ordered by LOWER(fullName), with pagination metadata', async () => {
    const res = await request(app).get('/api/admin/users?query=%20%40AU.test%20&pageSize=2').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 2 });
    expect(res.body.items.map((u) => u.username)).toEqual(['au-alice', 'au-bob']);
    expect(res.body.items[0]).toEqual({
      id: expect.any(Number), username: 'au-alice', fullName: 'Alice Au',
      email: 'alice@au.test', role: 'reader', enabled: true,
    });
  });

  it('matches username, email and treats % literally', async () => {
    const byEmail = await request(app).get('/api/admin/users?query=BOB@AU').set(auth(adminToken));
    expect(byEmail.body.items.map((u) => u.username)).toEqual(['au-bob']);

    const percent = await request(app).get('/api/admin/users?query=100%25').set(auth(adminToken));
    expect(percent.body.items.map((u) => u.username)).toEqual(['au-carol']);
    const wildcard = await request(app).get('/api/admin/users?query=%25').set(auth(adminToken));
    expect(wildcard.body.total).toBe(1);
  });

  it('pages without duplicates and returns 200 with empty items past the end', async () => {
    const p1 = await request(app).get('/api/admin/users?query=au-&pageSize=2&page=1').set(auth(adminToken));
    const p2 = await request(app).get('/api/admin/users?query=au-&pageSize=2&page=2').set(auth(adminToken));
    const ids = [...p1.body.items, ...p2.body.items].map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(p1.body.total).toBe(5);

    const beyond = await request(app).get('/api/admin/users?query=au-&pageSize=2&page=99').set(auth(adminToken));
    expect(beyond.status).toBe(200);
    expect(beyond.body).toMatchObject({ items: [], total: 5, page: 99 });
  });

  it('never leaks secrets', async () => {
    const res = await request(app).get('/api/admin/users?query=au-').set(auth(adminToken));
    expect(JSON.stringify(res.body)).not.toMatch(/password|sessionsValidAfter|\$2[aby]\$/);
  });
});

describe('PATCH /api/admin/users/:username', () => {
  it('validates the body and the email', async () => {
    const send = (body) => request(app).patch(url('au-bob')).set(auth(adminToken)).send(body);
    expect((await send({})).body.errorKey).toBe('admin.users.invalidFields');
    expect((await send({ role: 'admin' })).body.errorKey).toBe('admin.users.invalidFields');
    expect((await send({ enabled: 'false' })).body.errorKey).toBe('admin.users.invalidFields');
    expect((await send({ email: 'nope' })).body.errorKey).toBe('admin.users.invalidEmail');
    expect((await send({ email: '' })).status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await request(app).patch(url('ghost')).set(auth(adminToken)).send({ enabled: false });
    expect(res.status).toBe(404);
    expect(res.body.errorKey).toBe('admin.users.notFound');
  });

  it('updates the email, rejects case-insensitive duplicates and audits', async () => {
    const ok = await request(app).patch(url('au-bob')).set(auth(adminToken)).send({ email: ' Bob.New@au.test ' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ username: 'au-bob', email: 'Bob.New@au.test', enabled: true });

    const dup = await request(app).patch(url('au-alice')).set(auth(adminToken)).send({ email: 'BOB.NEW@au.test' });
    expect(dup.status).toBe(409);
    expect(dup.body.errorKey).toBe('admin.users.duplicateEmail');

    const entry = await prisma.auditLog.findFirst({ where: { actorUserId: adminId, action: 'user.email.update' } });
    expect(entry.metadata).toEqual({ from: 'bob@au.test', to: 'Bob.New@au.test' });
  });

  it('disabling revokes sessions and blocks login with 403; enabling restores login', async () => {
    const session = await login('au-carol');
    await sleep(1100);

    const off = await request(app).patch(url('au-carol')).set(auth(adminToken)).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.user.enabled).toBe(false);

    expect((await request(app).get('/api/me').set(auth(session.accessToken))).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);

    const blocked = await request(app).post('/api/auth/login').send({ username: 'au-carol', password: 'pass-1234' });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ success: false, errorKey: 'login.accountDisabled' });
    const wrong = await request(app).post('/api/auth/login').send({ username: 'au-carol', password: 'nope' });
    expect(wrong.status).toBe(401);

    const again = await request(app).patch(url('au-carol')).set(auth(adminToken)).send({ enabled: false });
    expect(again.status).toBe(200);

    await sleep(1100);
    await request(app).patch(url('au-carol')).set(auth(adminToken)).send({ enabled: true });
    expect((await request(app).get('/api/me').set(auth(session.accessToken))).status).toBe(401);
    expect((await login('au-carol')).success).toBe(true);

    const actions = (await prisma.auditLog.findMany({ where: { actorUserId: adminId } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['user.disable', 'user.enable']));
  });

  it('blocks self-disable (409) but allows self-enable as a no-op', async () => {
    const off = await request(app).patch(url('au-admin')).set(auth(adminToken)).send({ enabled: false });
    expect(off.status).toBe(409);
    expect(off.body.errorKey).toBe('admin.users.cannotModifySelf');
    const on = await request(app).patch(url('au-admin')).set(auth(adminToken)).send({ enabled: true });
    expect(on.status).toBe(200);
  });
});

describe('DELETE /api/admin/users/:username', () => {
  it('returns 404 for unknown users and 409 for self', async () => {
    expect((await request(app).delete(url('ghost')).set(auth(adminToken))).body.errorKey).toBe('admin.users.notFound');
    const self = await request(app).delete(url('au-admin')).set(auth(adminToken));
    expect(self.status).toBe(409);
    expect(self.body.errorKey).toBe('admin.users.cannotModifySelf');
  });

  it('deletes a user, revokes their token, keeps their books and audits the username', async () => {
    const session = await login('au-bob');
    const book = await prisma.book.create({
      data: { title: 'Bob book', author: 'Bob', status: 'available', uploadedBy: 'au-bob' },
    });

    const res = await request(app).delete(url('au-bob')).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect((await request(app).get('/api/me').set(auth(session.accessToken))).status).toBe(401);
    expect(await prisma.book.findUnique({ where: { id: book.id } })).not.toBeNull();
    const entry = await prisma.auditLog.findFirst({ where: { actorUserId: adminId, action: 'user.delete' } });
    expect(entry.metadata).toEqual({ username: 'au-bob' });
    await prisma.book.delete({ where: { id: book.id } });
  });

  // The last-admin guard cannot be hit through the API with a valid caller (the caller is
  // itself an enabled admin), so it is covered by adminUsers.service.unit.test.js.
  it('can delete another admin while the caller remains an enabled admin', async () => {
    const res = await request(app).delete(url('au-admin2')).set(auth(adminToken));
    expect(res.status).toBe(200);
  });
});
