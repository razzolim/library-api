import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { parseCsv } from '../src/lib/csv.js';
import { parseBooksCsv } from '../src/services/booksImport.service.js';

const ADMIN = 'export-test-admin';
const READER = 'export-test-reader';
const HEADER = 'title,author,status,genre,year,isbn,pdfUrl,summary,coverColor';
let adminToken;
let readerToken;
let adminId;

const login = async (username, password) =>
  (await request(app).post('/api/auth/login').send({ username, password })).body.accessToken;

const download = (token) => {
  const req = request(app)
    .get('/api/books/export')
    .set('Accept', 'text/csv')
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
};

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: [ADMIN, READER] } } });
  const hash = await bcrypt.hash('pass-1234', 10);
  adminId = (await prisma.user.create({ data: { username: ADMIN, password: hash, fullName: 'Export Admin', role: 'admin' } })).id;
  await prisma.user.create({ data: { username: READER, password: hash, fullName: 'Export Reader', role: 'reader' } });
  adminToken = await login(ADMIN, 'pass-1234');
  readerToken = await login(READER, 'pass-1234');
});

afterAll(async () => {
  await prisma.book.deleteMany({ where: { uploadedBy: ADMIN } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminId } });
  await prisma.user.deleteMany({ where: { username: { in: [ADMIN, READER] } } });
  await prisma.$disconnect();
});

describe('GET /api/books/export', () => {
  it('rejects requests without a token', async () => {
    expect((await download(null)).status).toBe(401);
  });

  it('returns 403 admin.forbidden for a non-admin', async () => {
    const res = await request(app).get('/api/books/export').set('Authorization', `Bearer ${readerToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorKey: 'admin.forbidden' });
  });

  it('exports every book as BOM + CRLF CSV, escaped, ordered by id, and audits once', async () => {
    await prisma.book.createMany({
      data: [
        {
          title: '=HYPERLINK("http://x")', author: 'Gamma, Helm', status: 'available', year: 1994,
          isbn: '978-1-22222-222-0', isbnNormalized: '9781222222220', pdfUrl: 'https://example.com/a.pdf',
          summary: 'Line one,\nline "two"', coverColor: '#112233', uploadedBy: ADMIN,
        },
        { title: '-5', author: 'Plain', status: 'borrowed', coverColor: '#4a5568', uploadedBy: ADMIN },
      ],
    });

    const res = await download(adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="books-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers['cache-control']).toBe('no-store');

    const raw = res.body;
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = raw.toString('utf8');
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.slice(1).startsWith(`${HEADER}\r\n`)).toBe(true);

    const records = parseCsv(text);
    // Other test files share the database, so compare the file with its own snapshot count.
    const total = records.length - 1;
    expect(res.headers['x-total-count']).toBe(String(total));
    const mine = records.slice(1).filter((r) => r.values[0] !== '' && ["'=HYPERLINK(\"http://x\")", '-5'].includes(r.values[0]));
    expect(mine.map((r) => r.values)).toEqual([
      ["'=HYPERLINK(\"http://x\")", 'Gamma, Helm', 'available', '', '1994', '978-1-22222-222-0', 'https://example.com/a.pdf', 'Line one,\nline "two"', '#112233'],
      ['-5', 'Plain', 'borrowed', '', '', '', '', '', '#4a5568'],
    ]);
    expect(text).not.toContain('null');

    const audits = await prisma.auditLog.findMany({ where: { actorUserId: adminId, action: 'book.export' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ count: total });
  });

  it('produces a file the importer accepts (round trip)', async () => {
    const text = (await download(adminToken)).body.toString('utf8');
    const rows = parseCsv(text).slice(1);
    // Re-import only validates the header/columns here; apostrophe-prefixed rows are still valid titles.
    const parsed = parseBooksCsv(`${HEADER}\r\n${rows.slice(0, 1).map((r) => r.values.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n')}`);
    expect(parsed.error).toBeUndefined();
  });
});
