import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as pdfService from '../services/pdf.service.js';

const NOT_FOUND = { success: false, errorKey: 'reader.notFound' };

export async function streamPdf(req, res, next) {
  try {
    const book = await pdfService.findBookForPdf(Number(req.params.id));
    if (!book) {
      return res.status(404).json(NOT_FOUND);
    }
    if (!book.pdfUrl) {
      return res.status(404).json({ success: false, errorKey: 'reader.noPdf' });
    }

    const etag = pdfService.pdfEtag(book.pdfUrl);
    res.set({
      'Cache-Control': 'private, max-age=3600',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    if (pdfService.matchesEtag(req.headers['if-none-match'], etag)) {
      return res.status(304).end();
    }

    // Aborts the upstream request if the client goes away mid-stream.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const source = await pdfService.openPdfSource(book.pdfUrl, req.headers.range, abort.signal);

    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdfService.pdfFilename(book.title)}"`,
    });
    if (source.status === 416) {
      res.set('Content-Range', source.contentRange ?? 'bytes */*');
      return res.status(416).end();
    }
    if (source.contentLength) {
      res.set('Content-Length', source.contentLength);
    }
    if (source.status === 206 && source.contentRange) {
      res.set('Content-Range', source.contentRange);
    }
    res.status(source.status === 206 && source.contentRange ? 206 : 200);

    if (req.method === 'HEAD') {
      await source.body.cancel();
      return res.end();
    }
    await pipeline(Readable.fromWeb(source.body), res);
    return undefined;
  } catch (err) {
    if (err.code === 'SOURCE_UNAVAILABLE') {
      res.set('Cache-Control', 'no-store');
      res.removeHeader('ETag');
      return res.status(502).json({ success: false, errorKey: 'reader.sourceUnavailable' });
    }
    if (res.headersSent) {
      // Mid-stream failure (client abort or upstream drop): nothing useful left to send.
      return res.destroy();
    }
    return next(err);
  }
}
