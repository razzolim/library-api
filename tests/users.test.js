import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const TEST_USERNAMES = ['pw-reader', 'pw-admin', 'admin-created', 'deactivated-user'];

let token;
let adminToken;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: TEST_USERNAMES } } });

  await prisma.user.createMany({
    data: [
      {
        username: 'pw-reader',
        password: await bcrypt.hash('initial-pass', 10),
        fullName: 'PW Reader',
        role: 'reader',
      },
      {
        username: 'pw-admin',
        password: await bcrypt.hash('admin-pass', 10),
        fullName: 'PW Admin',
        role: 'admin',
      },
    ],
  });

  const readerLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'pw-reader', password: 'initial-pass' });
  token = readerLogin.body.token;

  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'pw-admin', password: 'admin-pass' });
  adminToken = adminLogin.body.token;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: TEST_USERNAMES } } });
  await prisma.$disconnect();
});

describe('POST /api/users', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'x', password: 'y', fullName: 'Z' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'x', password: 'y', fullName: 'Z' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'pass', fullName: 'Bob' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, errorKey: 'users.createUser.missingFields' });
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'bob', fullName: 'Bob' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when fullName is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'bob', password: 'pass' });
    expect(res.status).toBe(400);
  });

  it('creates the user and returns 201 with public profile', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'admin-created', password: 'pass123', fullName: 'Admin Created' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      username: 'admin-created',
      fullName: 'Admin Created',
      role: 'reader',
    });
    expect(res.body.user.password).toBeUndefined();
  });

  it('allows the new user to log in with the provided password', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin-created', password: 'pass123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
  });

  it('returns 409 when username is already taken', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'admin-created', password: 'pass', fullName: 'Dup' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, errorKey: 'users.createUser.usernameTaken' });
  });
});

describe('PATCH /api/users/:id/deactivate', () => {
  let readerId;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: 'deactivated-user' } });
    const user = await prisma.user.create({
      data: {
        username: 'deactivated-user',
        password: await bcrypt.hash('deact-pass', 10),
        fullName: 'Deactivated User',
        role: 'reader',
      },
    });
    readerId = user.id;
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).patch(`/api/users/${readerId}/deactivate`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const res = await request(app)
      .patch(`/api/users/${readerId}/deactivate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent user id', async () => {
    const res = await request(app)
      .patch('/api/users/999999/deactivate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-numeric id', async () => {
    const res = await request(app)
      .patch('/api/users/abc/deactivate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when trying to deactivate an admin', async () => {
    const adminUser = await prisma.user.findUnique({ where: { username: 'pw-admin' } });
    const res = await request(app)
      .patch(`/api/users/${adminUser.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      errorKey: 'users.deactivateUser.cannotDeactivateAdmin',
    });
  });

  it('deactivates the user and returns 200', async () => {
    const res = await request(app)
      .patch(`/api/users/${readerId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('deactivated user token is rejected on protected routes', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pw-reader', password: 'initial-pass' });
    const readerToken = loginRes.body.token;

    const pwReader = await prisma.user.findUnique({ where: { username: 'pw-reader' } });
    await request(app)
      .patch(`/api/users/${pwReader.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const booksRes = await request(app)
      .get('/api/books')
      .set('Authorization', `Bearer ${readerToken}`);
    expect(booksRes.status).toBe(401);

    // Restore for later tests
    await prisma.user.update({ where: { id: pwReader.id }, data: { isActive: true } });
  });

  it('deactivated user login returns accountDeactivated error', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'deactivated-user', password: 'deact-pass' });
    expect(loginRes.status).toBe(401);
    expect(loginRes.body).toEqual({ success: false, errorKey: 'login.accountDeactivated' });
  });
});

describe('PATCH /api/users/me/password', () => {
  it('rejects requests with no token', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .send({ currentPassword: 'initial-pass', newPassword: 'new-pass' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when currentPassword is missing', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'new-pass' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, errorKey: 'users.changePassword.missingFields' });
  });

  it('returns 400 when newPassword is missing', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'initial-pass' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, errorKey: 'users.changePassword.missingFields' });
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not-the-right-one', newPassword: 'new-pass' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      errorKey: 'users.changePassword.wrongCurrentPassword',
    });
  });

  it('returns 200 and login with new password succeeds', async () => {
    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'initial-pass', newPassword: 'changed-pass' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pw-reader', password: 'changed-pass' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
  });

  it('rejects login with the old password after a successful change', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pw-reader', password: 'initial-pass' });
    expect(loginRes.status).toBe(401);
  });

  it('also works for admin role — any authenticated user can change their own password', async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'pw-admin', password: 'admin-pass' });
    const adminToken = adminLogin.body.token;

    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'admin-pass', newPassword: 'admin-new-pass' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
