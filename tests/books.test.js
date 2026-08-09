import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signToken } from '../src/lib/jwt.js';

let token;

beforeAll(async () => {
  await prisma.book.deleteMany();
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

  token = signToken({ sub: 1, username: 'reader', role: 'reader' });
});

afterAll(async () => {
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
