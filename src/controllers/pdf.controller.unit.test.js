import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/prisma.js', () => ({ prisma: { book: { findUnique: vi.fn() } } }));

const { prisma } = await import('../lib/prisma.js');
const { streamPdf } = await import('./pdf.controller.js');

const PDF = Buffer.from('%PDF-1.4 ' + 'x'.repeat(500));
let upstream;
let base;

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (req.url === '/html') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>quota</html>');
    } else if (range) {
      res.writeHead(206, {
        'Content-Type': 'application/pdf',
        'Content-Range': `bytes ${range[1]}-${range[2]}/${PDF.length}`,
        'Content-Length': Number(range[2]) - Number(range[1]) + 1,
      });
      res.end(PDF.subarray(Number(range[1]), Number(range[2]) + 1));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length }).end(PDF);
    }
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${upstream.address().port}`;
});

afterAll(() => upstream.close());

const app = express();
app.get('/books/:id/pdf', streamPdf);

describe('streamPdf', () => {
  it('relays a range request as 206 with Content-Range', async () => {
    prisma.book.findUnique.mockResolvedValue({ id: 1, title: 'Café Déjà Vu!', pdfUrl: `${base}/a.pdf` });
    const res = await request(app).get('/books/1/pdf').set('Range', 'bytes=0-99');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-99/${PDF.length}`);
    expect(res.headers['content-disposition']).toBe('inline; filename="cafe-deja-vu.pdf"');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('answers a matching If-None-Match with 304 without contacting storage', async () => {
    prisma.book.findUnique.mockResolvedValue({ id: 1, title: 'T', pdfUrl: 'http://127.0.0.1:1/unreachable.pdf' });
    const first = await request(app).get('/books/1/pdf');
    expect(first.status).toBe(502);
    const etag = (await import('../services/pdf.service.js')).pdfEtag('http://127.0.0.1:1/unreachable.pdf');
    const res = await request(app).get('/books/1/pdf').set('If-None-Match', etag);
    expect(res.status).toBe(304);
  });

  it('treats a non-PDF upstream response as unavailable', async () => {
    prisma.book.findUnique.mockResolvedValue({ id: 1, title: 'T', pdfUrl: `${base}/html` });
    const res = await request(app).get('/books/1/pdf');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ success: false, errorKey: 'reader.sourceUnavailable' });
  });
});
