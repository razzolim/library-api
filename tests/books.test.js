import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

let token;

beforeAll(async () => {
  await prisma.book.deleteMany();
  await prisma.user.deleteMany({ where: { username: 'books-test-reader' } });

  await prisma.book.createMany({
    data: [
      {
        title: 'The Pragmatic Programmer',
        author: 'Andrew Hunt & David Thomas',
        year: 1999,
        genre: 'Software Engineering',
        status: 'available',
        isbn: '978-0201616224',
        coverColor: '#4a5568',
        summary: 'A catalog of practical, tool-agnostic habits for writing adaptable software.',
        pdfUrl: 'https://drive.google.com/file/d/example/view',
      },
      {
        title: 'Clean Code',
        author: 'Robert C. Martin',
        year: 2008,
        genre: 'Software Engineering',
        status: 'borrowed',
        isbn: '978-0132350884',
        coverColor: '#2b6cb0',
        summary: 'A field guide to writing readable, maintainable code.',
      },
    ],
  });

  await prisma.user.create({
    data: {
      username: 'books-test-reader',
      password: await bcrypt.hash('books-pass', 10),
      fullName: 'Books Test Reader',
      role: 'reader',
    },
  });

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'books-test-reader', password: 'books-pass' });
  token = loginRes.body.accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: 'books-test-reader' } });
  await prisma.$disconnect();
});

describe('GET /api/books', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/books');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a malformed Authorization header', async () => {
    const res = await request(app).get('/api/books').set('Authorization', 'not-a-bearer-token');
    expect(res.status).toBe(401);
  });

  it('returns the full catalog for authenticated requests', async () => {
    const res = await request(app).get('/api/books').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ title: 'The Pragmatic Programmer', status: 'available' });
    expect(res.body[0].summary).toBeUndefined();
    expect(res.body[0].pdfUrl).toBeUndefined();
  });
});

describe('GET /api/books/:id', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/books/1');
    expect(res.status).toBe(401);
  });

  it('returns a single book by id', async () => {
    const list = await request(app).get('/api/books').set('Authorization', `Bearer ${token}`);
    const id = list.body[0].id;

    const res = await request(app).get(`/api/books/${id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.title).toBe('The Pragmatic Programmer');
    expect(res.body.summary).toBe('A catalog of practical, tool-agnostic habits for writing adaptable software.');
    expect(res.body.pdfUrl).toBe('https://drive.google.com/file/d/example/view');
  });

  it('returns 404 with no body for a non-existent id', async () => {
    const res = await request(app).get('/api/books/999999').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({});
    expect(res.text).toBe('');
  });

  it('returns 404 with no body for a non-numeric id', async () => {
    const res = await request(app).get('/api/books/not-a-number').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.text).toBe('');
  });
});
