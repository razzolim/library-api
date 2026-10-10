import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const ADMIN = 'import-test-admin';
const READER = 'import-test-reader';
const HEADER = 'title,author,status,genre,year,isbn,pdfUrl,summary,coverColor';
let adminToken;
let readerToken;
let adminId;

const login = async (username, password) =>
  (await request(app).post('/api/auth/login').send({ username, password })).body.accessToken;

const upload = (token, csv, type = 'text/csv') => {
  const req = request(app).post('/api/books/import').set('Content-Type', type);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(csv);
};

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: [ADMIN, READER] } } });
  const hash = await bcrypt.hash('pass-1234', 10);
  adminId = (await prisma.user.create({ data: { username: ADMIN, password: hash, fullName: 'Import Admin', role: 'admin' } })).id;
  await prisma.user.create({ data: { username: READER, password: hash, fullName: 'Import Reader', role: 'reader' } });
  adminToken = await login(ADMIN, 'pass-1234');
  readerToken = await login(READER, 'pass-1234');
});

afterAll(async () => {
  await prisma.book.deleteMany({ where: { uploadedBy: ADMIN } });
  await prisma.user.deleteMany({ where: { username: { in: [ADMIN, READER] } } });
  await prisma.$disconnect();
});

describe('POST /api/books/import', () => {
  it('rejects requests without a token', async () => {
    expect((await upload(null, `${HEADER}\n`)).status).toBe(401);
  });

  it('returns 403 admin.forbidden for a non-admin', async () => {
    const res = await upload(readerToken, `${HEADER}\nT,A,available,,,,,,`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorKey: 'admin.forbidden' });
  });

  it('returns 415 for a non-CSV content type', async () => {
    const res = await upload(adminToken, '{}', 'application/json');
    expect(res.status).toBe(415);
    expect(res.body.errorKey).toBe('admin.books.import.unsupportedMediaType');
  });

  it('imports valid rows (quoted fields, defaults, hyphenated ISBN) and audits once', async () => {
    const csv = [
      HEADER,
      'Imp Book One,"Doe, Jane",available,Fiction,2020,978-1-11111-111-3,https://example.com/a.pdf,"A ""quoted"" summary",#112233',
      'Imp Book Two,John Roe,borrowed,,,,,,',
    ].join('\r\n');
    const res = await upload(adminToken, csv);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, imported: 2 });

    const books = await prisma.book.findMany({ where: { uploadedBy: ADMIN }, orderBy: { id: 'asc' } });
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      title: 'Imp Book One', author: 'Doe, Jane', year: 2020, isbn: '978-1-11111-111-3',
      isbnNormalized: '9781111111113', summary: 'A "quoted" summary', coverColor: '#112233',
    });
    expect(books[1]).toMatchObject({ status: 'borrowed', genre: null, year: null, isbn: null, coverColor: '#4a5568' });

    const audits = await prisma.auditLog.findMany({ where: { actorUserId: adminId, action: 'book.import' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ count: 2 });
  });

  it('is all-or-nothing: reports every invalid row by line and inserts nothing', async () => {
    const before = await prisma.book.count({ where: { uploadedBy: ADMIN } });
    const csv = [
      HEADER,
      'Good Row,A,available,,,,,,',
      ',A,available,,,,,,',
      'Bad Year,A,available,,abc,,,,',
      'Bad Status,A,lost,,,,,,',
      'Short row,A',
    ].join('\n');
    const res = await upload(adminToken, csv);

    expect(res.status).toBe(400);
    expect(res.body.errorKey).toBe('admin.books.import.invalidRows');
    expect(res.body.errors).toEqual([
      { line: 3, fields: { title: 'required' } },
      { line: 4, fields: { year: 'invalid_type' } },
      { line: 5, fields: { status: 'invalid' } },
      { line: 6, fields: { row: 'column_count_mismatch' } },
    ]);
    expect(await prisma.book.count({ where: { uploadedBy: ADMIN } })).toBe(before);
  });

  it('rejects duplicate ISBNs inside the file, and ISBNs already in the catalog (409)', async () => {
    const inFile = await upload(adminToken, `${HEADER}\nA,A,available,,,978-2-22222-222-3,,,\nB,B,available,,,9782222222223,,,`);
    expect(inFile.status).toBe(400);
    expect(inFile.body.errors).toEqual([{ line: 3, fields: { isbn: 'duplicate_in_file' } }]);

    const existing = await upload(adminToken, `${HEADER}\nC,C,available,,,978-1-11111-111-3,,,`);
    expect(existing.status).toBe(409);
    expect(existing.body).toMatchObject({
      success: false,
      errorKey: 'admin.books.import.duplicateIsbn',
      errors: [{ line: 2, fields: { isbn: 'duplicate' } }],
    });
  });

  it('rejects a bad header, naming missing and unknown columns', async () => {
    const res = await upload(adminToken, 'title,writer\nT,W');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      errorKey: 'admin.books.import.invalidHeader',
      missing: ['author', 'status'],
      unknown: ['writer'],
    });
  });

  it('rejects an empty file and a header-only file', async () => {
    expect((await upload(adminToken, '')).body.errorKey).toBe('admin.books.import.invalidFile');
    expect((await upload(adminToken, `${HEADER}\n`)).body.errorKey).toBe('admin.books.import.invalidFile');
  });

  it('rejects files over the row limit', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => `T${i},A,available,,,,,,`);
    const res = await upload(adminToken, [HEADER, ...rows].join('\n'));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ errorKey: 'admin.books.import.tooManyRows', maxRows: 500 });
  });

  it('returns 413 for a file over the size limit', async () => {
    const res = await upload(adminToken, `${HEADER}\n${'x'.repeat(1024 * 1024 + 1)}`);
    expect(res.status).toBe(413);
    expect(res.body.errorKey).toBe('admin.books.import.fileTooLarge');
  });
});
