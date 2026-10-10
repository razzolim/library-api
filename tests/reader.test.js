import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const USERS = ['rd-one', 'rd-two'];
const PDF = Buffer.from('%PDF-1.4 ' + 'x'.repeat(2000));

let upstream;
let upstreamUrl;
let books;
let tokenOne;
let tokenTwo;

function startUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/broken.pdf') {
        res.writeHead(500).end('secret upstream error');
        return;
      }
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (!range) {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length });
        res.end(PDF);
        return;
      }
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : PDF.length - 1;
      if (start >= PDF.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${PDF.length}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': 'application/pdf',
        'Content-Range': `bytes ${start}-${end}/${PDF.length}`,
        'Content-Length': end - start + 1,
      });
      res.end(PDF.subarray(start, end + 1));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res.body.accessToken;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  upstream = await startUpstream();
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

  await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  await prisma.book.deleteMany({ where: { uploadedBy: 'rd-seed' } });
  for (const username of USERS) {
    await prisma.user.create({
      data: { username, password: await bcrypt.hash('rd-pass', 10), fullName: username, role: 'reader' },
    });
  }
  const make = (data) => prisma.book.create({ data: { author: 'A', uploadedBy: 'rd-seed', ...data } });
  books = {
    pdf: await make({ title: 'Reader Book', pdfUrl: `${upstreamUrl}/book.pdf`, pageCount: 256 }),
    noPdf: await make({ title: 'No PDF' }),
    broken: await make({ title: 'Broken', pdfUrl: `${upstreamUrl}/broken.pdf` }),
  };
  tokenOne = await login('rd-one', 'rd-pass');
  tokenTwo = await login('rd-two', 'rd-pass');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  await prisma.book.deleteMany({ where: { uploadedBy: 'rd-seed' } });
  await prisma.$disconnect();
  upstream.close();
});

describe('GET /api/books/:id/pdf', () => {
  const url = (id) => `/api/books/${id}/pdf`;

  it('requires a token', async () => {
    expect((await request(app).get(url(books.pdf.id))).status).toBe(401);
  });

  it('streams the whole file with the documented headers', async () => {
    const res = await request(app).get(url(books.pdf.id)).set(auth(tokenOne)).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.body.equals(PDF)).toBe(true);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="reader-book.pdf"');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(PDF.length));
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers.etag).toBeDefined();
  });

  it('answers range requests with 206 and Content-Range', async () => {
    const res = await request(app).get(url(books.pdf.id)).set(auth(tokenOne)).set('Range', 'bytes=0-1023');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1023/${PDF.length}`);
    expect(res.headers['content-length']).toBe('1024');
  });

  it('answers an out-of-range request with 416', async () => {
    const res = await request(app).get(url(books.pdf.id)).set(auth(tokenOne)).set('Range', 'bytes=999999-');
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${PDF.length}`);
  });

  it('supports HEAD and If-None-Match', async () => {
    const head = await request(app).head(url(books.pdf.id)).set(auth(tokenOne));
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(PDF.length));

    const cached = await request(app).get(url(books.pdf.id)).set(auth(tokenOne)).set('If-None-Match', head.headers.etag);
    expect(cached.status).toBe(304);
  });

  it('returns reader.notFound / reader.noPdf', async () => {
    const missing = await request(app).get(url(999999)).set(auth(tokenOne));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, errorKey: 'reader.notFound' });

    const noPdf = await request(app).get(url(books.noPdf.id)).set(auth(tokenOne));
    expect(noPdf.status).toBe(404);
    expect(noPdf.body).toEqual({ success: false, errorKey: 'reader.noPdf' });
  });

  it('returns 502 without leaking upstream details when storage fails', async () => {
    const res = await request(app).get(url(books.broken.id)).set(auth(tokenOne));
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ success: false, errorKey: 'reader.sourceUnavailable' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('reading progress', () => {
  const url = (id) => `/api/books/${id}/progress`;

  it('defaults to page 1 for a book never opened, 404 for an unknown book', async () => {
    const res = await request(app).get(url(books.pdf.id)).set(auth(tokenOne));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookId: books.pdf.id, page: 1, totalPages: null, percent: 0, updatedAt: null });

    const missing = await request(app).get(url(999999)).set(auth(tokenOne));
    expect(missing.status).toBe(404);
    expect(missing.body.errorKey).toBe('reader.notFound');
  });

  it('saves and returns the position per user', async () => {
    const put = await request(app).put(url(books.pdf.id)).set(auth(tokenOne)).send({ page: 24, totalPages: 256 });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);
    expect(put.body.progress).toMatchObject({ bookId: books.pdf.id, page: 24, totalPages: 256, percent: 9.38 });
    expect(put.body.progress.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);

    const get = await request(app).get(url(books.pdf.id)).set(auth(tokenOne));
    expect(get.body).toMatchObject({ page: 24, totalPages: 256, percent: 9.38 });

    const other = await request(app).get(url(books.pdf.id)).set(auth(tokenTwo));
    expect(other.body.page).toBe(1);
  });

  it('rejects invalid positions with reader.invalidProgress', async () => {
    for (const body of [{ page: 300, totalPages: 256 }, { page: 0, totalPages: 10 }, { page: 1.5, totalPages: 10 }, { page: 1 }, {}]) {
      const res = await request(app).put(url(books.pdf.id)).set(auth(tokenOne)).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, errorKey: 'reader.invalidProgress' });
    }
  });

  it('lists started books most recent first via GET /me/reading', async () => {
    await request(app).put(url(books.noPdf.id)).set(auth(tokenOne)).send({ page: 5, totalPages: 10 });
    const res = await request(app).get('/api/me/reading').set(auth(tokenOne));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.book.id)).toEqual([books.noPdf.id, books.pdf.id]);
    expect(res.body.items[0]).toMatchObject({ page: 5, totalPages: 10, percent: 50 });
    expect(res.body.items[0].book).toEqual({
      id: books.noPdf.id, title: 'No PDF', author: 'A', coverColor: '#4a5568', coverUrl: null, isbn: null,
    });

    const limited = await request(app).get('/api/me/reading?limit=1').set(auth(tokenOne));
    expect(limited.body.items).toHaveLength(1);
    const none = await request(app).get('/api/me/reading').set(auth(tokenTwo));
    expect(none.body.items).toEqual([]);
  });
});

describe('bookmarks', () => {
  const url = (id) => `/api/books/${id}/bookmarks`;

  it('creates, repeats safely, lists and deletes', async () => {
    const created = await request(app).post(url(books.pdf.id)).set(auth(tokenOne)).send({ page: 24, note: '  Tracer bullets ' });
    expect(created.status).toBe(201);
    expect(created.body.bookmark).toMatchObject({ page: 24, note: 'Tracer bullets' });

    const again = await request(app).post(url(books.pdf.id)).set(auth(tokenOne)).send({ page: 24, note: 'Updated' });
    expect(again.status).toBe(200);
    expect(again.body.bookmark).toMatchObject({ id: created.body.bookmark.id, note: 'Updated' });

    await request(app).post(url(books.pdf.id)).set(auth(tokenOne)).send({ page: 3 });
    const list = await request(app).get(url(books.pdf.id)).set(auth(tokenOne));
    expect(list.body.items.map((b) => b.page)).toEqual([3, 24]);
    expect(await prisma.bookmark.count({ where: { bookId: books.pdf.id } })).toBe(2);

    const otherList = await request(app).get(url(books.pdf.id)).set(auth(tokenTwo));
    expect(otherList.body.items).toEqual([]);

    const foreign = await request(app).delete(`${url(books.pdf.id)}/${created.body.bookmark.id}`).set(auth(tokenTwo));
    expect(foreign.status).toBe(404);
    expect(foreign.body.errorKey).toBe('reader.bookmarkNotFound');

    const del = await request(app).delete(`${url(books.pdf.id)}/${created.body.bookmark.id}`).set(auth(tokenOne));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ success: true });
  });

  it('validates input and enforces the per-book limit', async () => {
    for (const body of [{ page: 0 }, { page: 257 }, { page: 'x' }, { page: 5, note: 'n'.repeat(501) }, { page: 5, note: 7 }]) {
      const res = await request(app).post(url(books.pdf.id)).set(auth(tokenTwo)).send(body);
      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('reader.invalidBookmark');
    }
    const missing = await request(app).post(url(999999)).set(auth(tokenTwo)).send({ page: 1 });
    expect(missing.body.errorKey).toBe('reader.notFound');

    const me = await prisma.user.findUnique({ where: { username: 'rd-two' } });
    await prisma.bookmark.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({ userId: me.id, bookId: books.noPdf.id, page: i + 1 })),
    });
    const over = await request(app).post(url(books.noPdf.id)).set(auth(tokenTwo)).send({ page: 201 });
    expect(over.status).toBe(409);
    expect(over.body.errorKey).toBe('reader.bookmarkLimit');
  });
});

describe('reader preferences', () => {
  it('merges partial updates and keeps the stored zoom', async () => {
    const zoom = await request(app).patch('/api/me').set(auth(tokenOne)).send({ readerPreferences: { zoom: 150 } });
    expect(zoom.body).toMatchObject({ success: true, readerPreferences: { pageTheme: 'light', zoom: 150 } });

    const theme = await request(app).patch('/api/me').set(auth(tokenOne)).send({ readerPreferences: { pageTheme: 'dark' } });
    expect(theme.status).toBe(200);
    expect(theme.body.readerPreferences).toEqual({ pageTheme: 'dark', zoom: 150 });

    const login = await request(app).post('/api/auth/login').send({ username: 'rd-one', password: 'rd-pass' });
    expect(login.body.user.readerPreferences).toEqual({ pageTheme: 'dark', zoom: 150 });
  });

  it('rejects unknown keys and bad values without changing locale', async () => {
    for (const readerPreferences of [{ foo: 1 }, { pageTheme: 'sepia' }, { zoom: 10 }, { zoom: 401 }, { zoom: 'wide' }, 'dark', null]) {
      const res = await request(app).patch('/api/me').set(auth(tokenTwo)).send({ locale: 'pt-BR', readerPreferences });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, errorKey: 'reader.invalidPreferences' });
    }
    const me = await request(app).get('/api/me').set(auth(tokenTwo));
    expect(me.body.locale).toBe('en');
    expect(me.body.readerPreferences).toEqual({ pageTheme: 'light', zoom: 'fit-width' });
  });
});

describe('deleting a book', () => {
  it('removes its progress and bookmarks', async () => {
    await request(app).put(`/api/books/${books.pdf.id}/progress`).set(auth(tokenOne)).send({ page: 2, totalPages: 9 });
    await request(app).post(`/api/books/${books.pdf.id}/bookmarks`).set(auth(tokenOne)).send({ page: 2 });
    await prisma.book.delete({ where: { id: books.pdf.id } });
    expect(await prisma.readingProgress.count({ where: { bookId: books.pdf.id } })).toBe(0);
    expect(await prisma.bookmark.count({ where: { bookId: books.pdf.id } })).toBe(0);
  });
});
