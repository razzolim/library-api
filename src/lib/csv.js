// Minimal RFC 4180 CSV parser: quoted fields, `""` escapes, embedded newlines/commas inside
// quotes, CRLF or LF line endings, optional UTF-8 BOM. Blank lines are skipped. Returns an
// array of `{ line, values }` where `line` is the 1-based file line the record starts on.
// Throws `Error('unterminated_quote')` when a quoted field never closes.
export function parseCsv(text) {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = [];
  let values = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let touched = false; // current record has any content (distinguishes blank lines)

  const endField = () => {
    values.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    if (touched || values.length > 1 || values[0] !== '') {
      records.push({ line: recordLine, values });
    }
    values = [];
    touched = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      touched = true;
    } else if (ch === ',') {
      endField();
      touched = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      field += ch;
      touched = true;
    }
  }

  if (inQuotes) {
    throw new Error('unterminated_quote');
  }
  if (field !== '' || values.length > 0 || touched) {
    endRecord();
  }
  return records;
}
