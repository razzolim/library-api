import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

const UPSTREAM_TIMEOUT_MS = 15_000;
const DRIVE_FILE_URL = /^https:\/\/drive\.google\.com\/file\/d\/([^/?#]+)/;

export function findBookForPdf(id) {
  if (!Number.isInteger(id)) {
    return null;
  }
  return prisma.book.findUnique({ where: { id }, select: { id: true, title: true, pdfUrl: true } });
}

// Stable per file version: it only changes when the stored source URL does, so a conditional
// request can be answered without contacting the storage at all.
export function pdfEtag(pdfUrl) {
  return `"${createHash('sha1').update(pdfUrl).digest('hex')}"`;
}

export function matchesEtag(ifNoneMatch, etag) {
  if (!ifNoneMatch) {
    return false;
  }
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === etag);
}

export function pdfFilename(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'book'}.pdf`;
}

// Google Drive `/view` links are pages, not files; the download endpoint serves the bytes.
function sourceUrl(pdfUrl) {
  const drive = DRIVE_FILE_URL.exec(pdfUrl);
  return drive ? `https://drive.google.com/uc?export=download&id=${drive[1]}` : pdfUrl;
}

// Opens the book's PDF in its storage. Resolves to `{ status, contentLength, contentRange, body }`
// (`body` is a web ReadableStream, not buffered), or throws `SOURCE_UNAVAILABLE`. Errors never
// carry the upstream URL or response text.
export async function openPdfSource(pdfUrl, range, clientSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), UPSTREAM_TIMEOUT_MS);
  const signals = [timeout.signal, ...(clientSignal ? [clientSignal] : [])];

  let upstream;
  try {
    upstream = await fetch(sourceUrl(pdfUrl), {
      headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) },
      signal: AbortSignal.any(signals),
    });
  } catch {
    throw sourceUnavailable();
  } finally {
    clearTimeout(timer);
  }

  const type = upstream.headers.get('content-type') ?? '';
  const isPdfLike = /^application\/(pdf|octet-stream)/i.test(type);
  const status = upstream.status;
  if (status === 416) {
    await upstream.body?.cancel();
    return { status, contentRange: upstream.headers.get('content-range'), body: null };
  }
  if ((status !== 200 && status !== 206) || !isPdfLike || !upstream.body) {
    await upstream.body?.cancel();
    throw sourceUnavailable();
  }
  return {
    status,
    contentLength: upstream.headers.get('content-length'),
    contentRange: upstream.headers.get('content-range'),
    body: upstream.body,
  };
}

function sourceUnavailable() {
  const err = new Error('PDF source unavailable');
  err.code = 'SOURCE_UNAVAILABLE';
  return err;
}
