import { prisma } from '../lib/prisma.js';
import { parseCsv } from '../lib/csv.js';
import { recordAudit } from './audit.service.js';
import { validateNewBook } from './books.service.js';

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 1024 * 1024;

const REQUIRED_COLUMNS = ['title', 'author', 'status'];
const OPTIONAL_COLUMNS = ['genre', 'year', 'isbn', 'pdfUrl', 'summary', 'coverColor'];
const KNOWN_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

// Parses and validates a CSV document into book rows, without touching the database.
// Returns `{ error }` for file-level problems (`errorKey` suffix + optional extras), `{ rowErrors }`
// for per-row validation failures, or `{ rows }` ready for insertion.
export function parseBooksCsv(text) {
  let records;
  try {
    records = parseCsv(text);
  } catch {
    return { error: { key: 'invalidFile' } };
  }
  if (records.length === 0) {
    return { error: { key: 'invalidFile' } };
  }

  const header = records[0].values.map((name) => name.trim());
  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  const unknown = header.filter((name) => !KNOWN_COLUMNS.includes(name));
  const duplicated = header.filter((name, i) => header.indexOf(name) !== i);
  if (missing.length > 0 || unknown.length > 0 || duplicated.length > 0) {
    return { error: { key: 'invalidHeader', extra: { missing, unknown, duplicated } } };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return { error: { key: 'invalidFile' } };
  }
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    return { error: { key: 'tooManyRows', extra: { maxRows: MAX_IMPORT_ROWS } } };
  }

  const rows = [];
  const rowErrors = [];
  const seenIsbns = new Map();

  for (const { line, values } of dataRecords) {
    if (values.length !== header.length) {
      rowErrors.push({ line, fields: { row: 'column_count_mismatch' } });
      continue;
    }

    // Empty cells mean "not provided" so optional fields fall back to the same defaults as POST /books.
    const input = {};
    header.forEach((name, i) => {
      const cell = values[i].trim();
      if (cell !== '') input[name] = cell;
    });
    if (input.year !== undefined) {
      input.year = /^\d+$/.test(input.year) ? Number(input.year) : input.year;
    }

    const { data, fields } = validateNewBook(input);
    if (fields) {
      rowErrors.push({ line, fields });
      continue;
    }

    if (data.isbnNormalized) {
      const firstLine = seenIsbns.get(data.isbnNormalized);
      if (firstLine !== undefined) {
        rowErrors.push({ line, fields: { isbn: 'duplicate_in_file' } });
        continue;
      }
      seenIsbns.set(data.isbnNormalized, line);
    }
    rows.push({ line, data });
  }

  return rowErrors.length > 0 ? { rowErrors } : { rows };
}

// Inserts every row or none: a single failure rolls the whole import back. Returns
// `{ rowErrors }` when ISBNs already exist in the catalog, otherwise `{ imported }`.
export async function importBooks(rows, actor, context = {}) {
  const isbns = rows.map((row) => row.data.isbnNormalized).filter(Boolean);

  return prisma.$transaction(async (tx) => {
    if (isbns.length > 0) {
      const existing = await tx.book.findMany({
        where: { isbnNormalized: { in: isbns } },
        select: { isbnNormalized: true },
      });
      const taken = new Set(existing.map((book) => book.isbnNormalized));
      const rowErrors = rows
        .filter((row) => taken.has(row.data.isbnNormalized))
        .map((row) => ({ line: row.line, fields: { isbn: 'duplicate' } }));
      if (rowErrors.length > 0) {
        return { rowErrors };
      }
    }

    const { count } = await tx.book.createMany({
      data: rows.map((row) => ({ ...row.data, uploadedBy: actor.username })),
    });
    await recordAudit(tx, {
      actorUserId: actor.sub,
      action: 'book.import',
      targetType: 'book',
      targetId: 'bulk',
      metadata: { count },
      ...context,
    });
    return { imported: count };
  });
}
