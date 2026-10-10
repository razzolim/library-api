import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

beforeAll(async () => {
  // Test files run in parallel against one database, so only touch this file's own user.
  const password = await bcrypt.hash('demo.user', 10);
  await prisma.user.upsert({
    where: { username: 'demo.user' },
    update: { password, isActive: true, role: 'demo.user' },
    create: { username: 'demo.user', password, fullName: 'Demo Reader', role: 'demo.user' },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  it('returns tokens and public profile for valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.expiresIn).toEqual(expect.any(Number));
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      username: 'demo.user',
      fullName: 'Demo Reader',
      role: 'demo.user',
      locale: expect.any(String),
      readerPreferences: { pageTheme: 'light', zoom: 'fit-width' },
    });
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejects an unknown username', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'demo.user' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, errorKey: 'login.invalidCredentials' });
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, errorKey: 'login.invalidCredentials' });
  });

  it('rejects a missing body', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, errorKey: 'login.invalidCredentials' });
  });

  it('accepts rememberMe flag without error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'demo.user', password: 'demo.user', rememberMe: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/auth/logout', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('invalidates the access token used to log out', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { accessToken } = loginRes.body;

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({ success: true });

    const booksRes = await request(app).get('/api/books').set('Authorization', `Bearer ${accessToken}`);
    expect(booksRes.status).toBe(401);
  });

  it('also revokes the refresh token when passed in the body', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { accessToken, refreshToken } = loginRes.body;

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });
    expect(refreshRes.status).toBe(401);
  });

  it('does not affect other valid access tokens', async () => {
    const firstLogin = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const secondLogin = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`);

    const booksRes = await request(app)
      .get('/api/books')
      .set('Authorization', `Bearer ${secondLogin.body.accessToken}`);
    expect(booksRes.status).toBe(200);
  });

  it('is safe to call twice with the same access token (second call returns 401)', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { accessToken } = loginRes.body;

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`);
    const secondLogoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(secondLogoutRes.status).toBe(401);
  });

  it('rejects a refresh token used as a bearer token', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { refreshToken } = loginRes.body;

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${refreshToken}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rejects requests with no body', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid refresh token string', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not.a.real.token' });
    expect(res.status).toBe(401);
  });

  it('returns 200 with a new accessToken and refreshToken', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { refreshToken } = loginRes.body;

    const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.accessToken).toEqual(expect.any(String));
    expect(refreshRes.body.refreshToken).toEqual(expect.any(String));
    expect(refreshRes.body.expiresIn).toEqual(expect.any(Number));
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
  });

  it('new accessToken is usable on protected routes', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { refreshToken } = loginRes.body;

    const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken });
    const { accessToken: newAccessToken } = refreshRes.body;

    const booksRes = await request(app).get('/api/books').set('Authorization', `Bearer ${newAccessToken}`);
    expect(booksRes.status).toBe(200);
  });

  it('old refreshToken is revoked after a successful refresh (rotation)', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { refreshToken } = loginRes.body;

    await request(app).post('/api/auth/refresh').send({ refreshToken });

    const secondRefreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(secondRefreshRes.status).toBe(401);
  });

  it('rejects an access token used as a refresh token', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ username: 'demo.user', password: 'demo.user' });
    const { accessToken } = loginRes.body;

    const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken: accessToken });
    expect(refreshRes.status).toBe(401);
  });
});
