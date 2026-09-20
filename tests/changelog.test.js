import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

let token;

beforeAll(async () => {
  await prisma.changelogEntry.deleteMany();
  await prisma.user.deleteMany({ where: { username: 'changelog-test-reader' } });

  await prisma.changelogEntry.createMany({
    data: [
      {
        version: '1.0.0',
        date: '2026-08-01',
        title: 'Initial release',
        description: "## What's new\n\n- Login page.",
      },
      {
        version: '1.1.0',
        date: '2026-08-05',
        title: 'Book collection',
        description: "## What's new\n\n- Browse the library collection.",
      },
    ],
  });

  await prisma.user.create({
    data: {
      username: 'changelog-test-reader',
      password: await bcrypt.hash('changelog-pass', 10),
      fullName: 'Changelog Test Reader',
      role: 'reader',
    },
  });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'changelog-test-reader', password: 'changelog-pass' });
  token = loginRes.body.accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: 'changelog-test-reader' } });
  await prisma.$disconnect();
});

describe('GET /api/changelog', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/changelog');
    expect(res.status).toBe(401);
  });

  it('returns changelog entries newest first', async () => {
    const res = await request(app)
      .get('/api/changelog')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ version: '1.1.0', title: 'Book collection' });
    expect(res.body[1]).toMatchObject({ version: '1.0.0', title: 'Initial release' });
  });
});
