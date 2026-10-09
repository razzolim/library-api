import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const USERNAMES = ['adm-reader', 'adm-admin', 'adm-target'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body;
}

let readerToken;
let adminToken;
let adminId;
let targetId;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
  await prisma.book.deleteMany({ where: { uploadedBy: 'adm-admin' } });

  for (const [username, role] of [['adm-reader', 'reader'], ['adm-admin', 'admin'], ['adm-target', 'reader']]) {
    await prisma.user.create({
      data: { username, password: await bcrypt.hash('old-password', 4), fullName: username, role },
    });
  }
  adminId = (await prisma.user.findUnique({ where: { username: 'adm-admin' } })).id;
  targetId = (await prisma.user.findUnique({ where: { username: 'adm-target' } })).id;

  readerToken = (await login('adm-reader', 'old-password')).accessToken;
  adminToken = (await login('adm-admin', 'old-password')).accessToken;
});

afterAll(async () => {
  await prisma.book.deleteMany({ where: { uploadedBy: 'adm-admin' } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
  await prisma.$disconnect();
});

describe('PATCH /api/admin/users/:username/password', () => {
  const url = (u) => `/api/admin/users/${encodeURIComponent(u)}/password`;

  it('returns 401 without a token', async () => {
    const res = await request(app).patch(url('adm-target')).send({ newPassword: 'new-password' });
    expect(res.status).toBe(401);
  });

  it('returns 403 admin.forbidden for a non-admin', async () => {
    const res = await request(app)
      .patch(url('adm-target'))
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ newPassword: 'new-password' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorKey: 'admin.forbidden' });
  });

  it('returns 400 weakPassword for a short password', async () => {
    const res = await request(app)
      .patch(url('adm-target'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.errorKey).toBe('admin.resetPassword.weakPassword');
  });

  it('returns 404 userNotFound for an unknown user', async () => {
    const res = await request(app)
      .patch(url('nobody-here'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'new-password' });
    expect(res.status).toBe(404);
    expect(res.body.errorKey).toBe('admin.resetPassword.userNotFound');
  });

  it('returns 400 useAccountPage when the admin targets themself', async () => {
    const res = await request(app)
      .patch(url('adm-admin'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'new-password' });
    expect(res.status).toBe(400);
    expect(res.body.errorKey).toBe('admin.resetPassword.useAccountPage');
  });

  it('resets the password, signs the target out everywhere and audits the action', async () => {
    const oldSession = await login('adm-target', 'old-password');
    await sleep(1100); // JWT iat has one-second resolution

    const res = await request(app)
      .patch(url('adm-target'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'brand-new-password' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, username: 'adm-target' });

    const oldAccess = await request(app).get('/api/me').set('Authorization', `Bearer ${oldSession.accessToken}`);
    expect(oldAccess.status).toBe(401);

    const oldRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: oldSession.refreshToken });
    expect(oldRefresh.status).toBe(401);

    expect((await login('adm-target', 'old-password')).success).toBe(false);

    await sleep(1100);
    const fresh = await login('adm-target', 'brand-new-password');
    expect(fresh.success).toBe(true);
    const meRes = await request(app).get('/api/me').set('Authorization', `Bearer ${fresh.accessToken}`);
    expect(meRes.status).toBe(200);

    const entries = await prisma.auditLog.findMany({ where: { actorUserId: adminId, action: 'user.password.reset' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ targetType: 'user', targetId: String(targetId) });
    expect(JSON.stringify(entries[0])).not.toContain('brand-new-password');
  });
});

describe('POST /api/books (admin spec)', () => {
  const post = (token, body) =>
    request(app).post('/api/books').set('Authorization', `Bearer ${token}`).send(body);

  it('returns 403 admin.forbidden for a non-admin', async () => {
    const res = await post(readerToken, { title: 'T', author: 'A', status: 'available' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorKey: 'admin.forbidden' });
  });

  it('returns 400 invalidFields with per-field details', async () => {
    const res = await post(adminToken, { title: '', author: 'A', status: 'available', year: 99999 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      errorKey: 'admin.books.invalidFields',
      fields: { title: 'required', year: 'out_of_range' },
    });
  });

  it('creates a book with only required fields, applying defaults', async () => {
    const res = await post(adminToken, { title: ' Minimal ', author: 'Someone', status: 'borrowed', id: 1, uploadedBy: 'evil' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.book).toMatchObject({
      title: 'Minimal', status: 'borrowed', coverColor: '#4a5568',
      genre: null, year: null, isbn: null, pdfUrl: null, summary: null, uploadedBy: 'adm-admin',
    });
    expect(res.body.book.id).not.toBe(1);
    expect(res.body.book).not.toHaveProperty('isbnNormalized');
  });

  it('creates a full book, is readable via GET /books/:id and is audited', async () => {
    const body = {
      title: 'Refactoring', author: 'Martin Fowler', genre: 'Software Engineering', year: 2018,
      isbn: '978-0134757599', status: 'available', pdfUrl: 'https://drive.google.com/file/d/x/view',
      summary: 'Improving the design of existing code.', coverColor: '#112233',
    };
    const res = await post(adminToken, body);
    expect(res.status).toBe(201);
    expect(res.body.book).toMatchObject(body);

    const get = await request(app).get(`/api/books/${res.body.book.id}`).set('Authorization', `Bearer ${readerToken}`);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject(body);

    const audit = await prisma.auditLog.findFirst({
      where: { actorUserId: adminId, action: 'book.create', targetId: String(res.body.book.id) },
    });
    expect(audit).toMatchObject({ targetType: 'book' });
  });

  it('returns 409 duplicateIsbn even when hyphenation differs', async () => {
    const res = await post(adminToken, { title: 'Dup', author: 'A', status: 'available', isbn: '9780134757599' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, errorKey: 'admin.books.duplicateIsbn' });
  });
});
