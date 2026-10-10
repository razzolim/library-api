import * as booksService from '../services/books.service.js';
import * as booksImportService from '../services/booksImport.service.js';
import * as booksExportService from '../services/booksExport.service.js';
import { requestContext } from '../lib/requestContext.js';

export async function listBooks(req, res, next) {
  try {
    const books = await booksService.listBooks();
    return res.status(200).json(books);
  } catch (err) {
    return next(err);
  }
}

export async function createBook(req, res, next) {
  try {
    const { data, fields } = booksService.validateNewBook(req.body);
    if (fields) {
      return res.status(400).json({ success: false, errorKey: 'admin.books.invalidFields', fields });
    }
    const book = await booksService.createBook(data, req.user, requestContext(req));
    return res.status(201).json({ success: true, book });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, errorKey: 'admin.books.duplicateIsbn' });
    }
    return next(err);
  }
}

export async function getBookById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const book = await booksService.getBookById(id);

    if (!book) {
      return res.status(404).end();
    }

    return res.status(200).json(book);
  } catch (err) {
    return next(err);
  }
}

export async function importBooks(req, res, next) {
  try {
    if (typeof req.body !== 'string') {
      return res.status(415).json({ success: false, errorKey: 'admin.books.import.unsupportedMediaType' });
    }

    const parsed = booksImportService.parseBooksCsv(req.body);
    if (parsed.error) {
      return res
        .status(400)
        .json({ success: false, errorKey: `admin.books.import.${parsed.error.key}`, ...parsed.error.extra });
    }
    if (parsed.rowErrors) {
      return res.status(400).json({ success: false, errorKey: 'admin.books.import.invalidRows', errors: parsed.rowErrors });
    }

    const result = await booksImportService.importBooks(parsed.rows, req.user, requestContext(req));
    if (result.rowErrors) {
      return res.status(409).json({ success: false, errorKey: 'admin.books.import.duplicateIsbn', errors: result.rowErrors });
    }
    return res.status(201).json({ success: true, imported: result.imported });
  } catch (err) {
    if (err.code === 'P2002') {
      // Lost a race with a concurrent insert of the same ISBN; the transaction rolled back.
      return res.status(409).json({ success: false, errorKey: 'admin.books.import.duplicateIsbn', errors: [] });
    }
    return next(err);
  }
}

export async function exportBooks(req, res, next) {
  // Headers go out only once the first reads succeeded, so earlier failures still get a JSON 500.
  const onStart = (total) => {
    const date = new Date().toISOString().slice(0, 10);
    res.status(200);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="books-${date}.csv"`,
      'Cache-Control': 'no-store',
      'X-Total-Count': String(total),
    });
  };
  const write = (chunk) =>
    res.write(chunk, 'utf8') ? undefined : new Promise((resolve) => res.once('drain', resolve));

  try {
    await booksExportService.streamBooksCsv({ onStart, write }, req.user, requestContext(req));
    return res.end();
  } catch (err) {
    if (res.headersSent) {
      // Mid-stream failure: the status line is gone, so abort the connection rather than end cleanly.
      console.error(err);
      return res.destroy(err);
    }
    return next(err);
  }
}
