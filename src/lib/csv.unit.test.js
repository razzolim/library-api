import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv.js';

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
