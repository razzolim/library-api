import { describe, it, expect } from 'vitest';
import { parseCsv, csvCell } from './csv.js';

describe('parseCsv', () => {
  it('parses simple rows with LF and CRLF endings and records start lines', () => {
    expect(parseCsv('a,b\r\nc,d\n')).toEqual([
      { line: 1, values: ['a', 'b'] },
      { line: 2, values: ['c', 'd'] },
    ]);
  });

  it('handles quoted commas, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('a,"b,1","say ""hi"""\n"x\ny",z,\nlast,row,here');
    expect(rows[0].values).toEqual(['a', 'b,1', 'say "hi"']);
    expect(rows[1]).toEqual({ line: 2, values: ['x\ny', 'z', ''] });
    expect(rows[2].line).toBe(4);
  });

  it('strips a BOM and skips blank lines', () => {
    expect(parseCsv('﻿a,b\n\n\nc,d')).toEqual([
      { line: 1, values: ['a', 'b'] },
      { line: 4, values: ['c', 'd'] },
    ]);
  });

  it('throws on an unterminated quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow('unterminated_quote');
  });
});

describe('csvCell', () => {
  it('leaves simple values and nulls alone', () => {
    expect(csvCell('abc')).toBe('abc');
    expect(csvCell(1994)).toBe('1994');
    expect(csvCell(null)).toBe('');
  });

  it('quotes commas, quotes and line breaks per RFC 4180', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it('prefixes formula-looking text but not plain numbers', () => {
    for (const v of ['=1+1', '+cmd', '-cmd', '@x', '\tx', '\rx']) {
      expect(csvCell(v, { text: true }).replace(/^"|"$/g, '')).toMatch(/^'/);
    }
    expect(csvCell('-5', { text: true })).toBe('-5');
    expect(csvCell('=1+1')).toBe('=1+1');
  });
});
