import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

let token;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: ['pw-reader', 'pw-admin'] } } });

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

  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'pw-reader', password: 'initial-pass' });
  token = res.body.token;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: ['pw-reader', 'pw-admin'] } } });
  await prisma.$disconnect();
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
