import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('./audit.service.js', () => ({ recordAudit: vi.fn() }));

import { parseBooksCsv, MAX_IMPORT_ROWS } from './booksImport.service.js';

const HEADER = 'title,author,status,genre,year,isbn,pdfUrl,summary,coverColor';

describe('parseBooksCsv', () => {
  it('maps valid rows, applying POST /books defaults for empty cells', () => {
    const { rows } = parseBooksCsv(
      `${HEADER}\nOne,"Doe, Jane",available,Fiction,2020,978-1-11111-111-3,,"A ""q"" summary",#112233\nTwo,Roe,borrowed,,,,,,`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, data: { title: 'One', author: 'Doe, Jane', year: 2020, isbnNormalized: '9781111111113', summary: 'A "q" summary', coverColor: '#112233' } });
    expect(rows[1].data).toMatchObject({ genre: null, year: null, isbn: null, coverColor: '#4a5568' });
  });

  it('accepts a header with only the required columns, in any order', () => {
    const { rows } = parseBooksCsv('status,author,title\navailable,A,T');
    expect(rows[0].data).toMatchObject({ title: 'T', author: 'A', status: 'available' });
  });

  it('reports row errors by file line, including multi-line quoted cells', () => {
    const { rowErrors } = parseBooksCsv(
      [HEADER, 'Good,A,available,,,,,,', ',A,available,,,,,,', 'Bad Year,A,available,,abc,,,,', 'S,A,lost,,,,,,', 'Short,A'].join('\n'),
    );
    expect(rowErrors).toEqual([
      { line: 3, fields: { title: 'required' } },
      { line: 4, fields: { year: 'invalid_type' } },
      { line: 5, fields: { status: 'invalid' } },
      { line: 6, fields: { row: 'column_count_mismatch' } },
    ]);
  });

  it('flags in-file duplicate ISBNs regardless of hyphenation', () => {
    const { rowErrors } = parseBooksCsv(`${HEADER}\nA,A,available,,,978-2-22222-222-3,,,\nB,B,available,,,9782222222223,,,`);
    expect(rowErrors).toEqual([{ line: 3, fields: { isbn: 'duplicate_in_file' } }]);
  });

  it('rejects bad headers, empty files and oversized files', () => {
    expect(parseBooksCsv('title,writer\nT,W').error).toEqual({
      key: 'invalidHeader',
      extra: { missing: ['author', 'status'], unknown: ['writer'], duplicated: [] },
    });
    expect(parseBooksCsv('').error.key).toBe('invalidFile');
    expect(parseBooksCsv(`${HEADER}\n`).error.key).toBe('invalidFile');
    expect(parseBooksCsv('a,"b').error.key).toBe('invalidFile');
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `T${i},A,available,,,,,,`);
    expect(parseBooksCsv([HEADER, ...many].join('\n')).error).toEqual({ key: 'tooManyRows', extra: { maxRows: MAX_IMPORT_ROWS } });
  });

  it('parses the shipped template without errors', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('../../documents/templates/books-import-template.csv', import.meta.url), 'utf8');
    const result = parseBooksCsv(text);
    expect(result.rowErrors).toBeUndefined();
    expect(result.rows).toHaveLength(3);
  });
});
