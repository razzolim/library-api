import { prisma } from '../lib/prisma.js';
import { csvCell } from '../lib/csv.js';
import { recordAudit } from './audit.service.js';

// Same columns, in the same order, as the import format (see booksImport.service.js).
export const EXPORT_COLUMNS = ['title', 'author', 'status', 'genre', 'year', 'isbn', 'pdfUrl', 'summary', 'coverColor'];
const NUMERIC_COLUMNS = new Set(['year']);
const BATCH_SIZE = 500;
const EXPORT_TX_TIMEOUT_MS = 5 * 60_000;

export function csvHeaderLine() {
  return `${EXPORT_COLUMNS.join(',')}\r\n`;
}

export function bookToCsvLine(book) {
  const cells = EXPORT_COLUMNS.map((name) => csvCell(book[name], { text: !NUMERIC_COLUMNS.has(name) }));
  return `${cells.join(',')}\r\n`;
}

// Streams every book as CSV through `write(chunk)` (which may return a promise for backpressure),
// reading in id-ordered batches inside one RepeatableRead transaction so the file is a single
// consistent snapshot. `onStart(total)` runs once, before the first `write`, so the caller can
// send headers only after the first reads succeeded. The `book.export` audit entry commits with
// the transaction, i.e. only when the whole catalog was read. Returns the exported row count.
export async function streamBooksCsv({ onStart, write }, actor, context = {}) {
  return prisma.$transaction(
    async (tx) => {
      const total = await tx.book.count();
      let batch = await tx.book.findMany({ orderBy: { id: 'asc' }, take: BATCH_SIZE });
      onStart(total);
      await write(`﻿${csvHeaderLine()}`);

      let count = 0;
      while (batch.length > 0) {
        await write(batch.map(bookToCsvLine).join(''));
        count += batch.length;
        if (batch.length < BATCH_SIZE) break;
        batch = await tx.book.findMany({
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          cursor: { id: batch[batch.length - 1].id },
          skip: 1,
        });
      }

      await recordAudit(tx, {
        actorUserId: actor.sub,
        action: 'book.export',
        targetType: 'book',
        targetId: 'bulk',
        metadata: { count },
        ...context,
      });
      return count;
    },
    { isolationLevel: 'RepeatableRead', timeout: EXPORT_TX_TIMEOUT_MS, maxWait: 10_000 },
  );
}
