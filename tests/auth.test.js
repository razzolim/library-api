import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

beforeAll(async () => {
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      username: 'reader',
      password: await bcrypt.hash('reader', 10),
      fullName: 'Demo Reader',
      role: 'reader',
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  it('returns a token and public profile for valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'reader', password: 'reader' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      username: 'reader',
      fullName: 'Demo Reader',
      role: 'reader',
    });
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejects an unknown username', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'reader' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, errorKey: 'login.invalidCredentials' });
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'reader', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, errorKey: 'login.invalidCredentials' });
  });

  it('rejects a missing body', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, errorKey: 'login.invalidCredentials' });
  });
});

describe('POST /api/auth/logout', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('invalidates the token used to log out', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'reader', password: 'reader' });
    const { token } = loginRes.body;

    const logoutRes = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({ success: true });

    const booksRes = await request(app).get('/api/books').set('Authorization', `Bearer ${token}`);
    expect(booksRes.status).toBe(401);
  });

  it('does not affect other valid tokens', async () => {
    const firstLogin = await request(app).post('/api/auth/login').send({ username: 'reader', password: 'reader' });
    const secondLogin = await request(app).post('/api/auth/login').send({ username: 'reader', password: 'reader' });

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${firstLogin.body.token}`);

    const booksRes = await request(app).get('/api/books').set('Authorization', `Bearer ${secondLogin.body.token}`);
    expect(booksRes.status).toBe(200);
  });

  it('is safe to call twice with the same token', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'reader', password: 'reader' });
    const { token } = loginRes.body;

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    const secondLogoutRes = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    expect(secondLogoutRes.status).toBe(401);
  });
});
