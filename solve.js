// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program): run(input) returns
// exactly csv-reader's {columns, rows, errors} for {text, header}, but much faster.
//
// Strategy: one pass, left to right, with V8's C++ string primitives doing the scanning.
//   - Fast path per record: the record's line (up to the next LF) holds no '"' and no stray
//     CR, so it is one slice + split(',') — no per-character work at all. CRLF endings are
//     recognised by the CR sitting right before the LF. This covers the bulk of every file.
//   - Slow path per field: indexOf scans for the next ',', LF or CR (unquoted) or the next
//     '"', CR or LF (quoted), slicing segments between the hits instead of concatenating
//     character by character. Quoted fields only build a parts array when they actually
//     contain a doubled quote or a line break; a plain quoted field is a single slice.
//   - Errors, line counting and record framing follow the reference exactly, including the
//     unterminated-quote rewind (reset pos/line to the opening quote, re-read as unquoted)
//     and the "line of only stray CRs is no record" rule.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: header).
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field starting at pos, onto `prefix` ('' normally; the quoted value
  // when reading the junk after a closing quote). Returns [value, ended, added] where added
  // counts the characters kept after the prefix (a stray CR is dropped, never kept).
  function readUnquoted(prefix) {
    let parts = null;
    let start = pos;
    for (;;) {
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      const ri = text.indexOf('\r', pos);
      let m = -1;
      let kind = 0;
      if (ci !== -1) { m = ci; kind = COMMA; }
      if (ni !== -1 && (m === -1 || ni < m)) { m = ni; kind = LINE_BREAK; }
      if (ri !== -1 && (m === -1 || ri < m)) { m = ri; kind = 2; }
      if (m === -1) {
        // End of the text: the rest of it is the field.
        const tail = text.slice(start, len);
        pos = len;
        if (parts === null) return [prefix === '' ? tail : prefix + tail, END, tail.length];
        if (tail !== '') parts.push(tail);
        return [parts.join(''), END, parts.join('').length - prefix.length];
      }
      if (kind === 2) {
        // CR: a line break when followed by LF, else a dropped stray CR (error stray_cr).
        if (m + 1 < len && text.charCodeAt(m + 1) === 10) {
          const seg = text.slice(start, m);
          pos = m + 2;
          line += 1;
          if (parts === null) return [prefix === '' ? seg : prefix + seg, LINE_BREAK, seg.length];
          if (seg !== '') parts.push(seg);
          const v = parts.join('');
          return [v, LINE_BREAK, v.length - prefix.length];
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (parts === null) {
          parts = [];
          if (prefix !== '') parts.push(prefix);
        }
        if (m > start) parts.push(text.slice(start, m));
        pos = m + 1;
        start = m + 1;
        continue;
      }
      const seg = text.slice(start, m);
      pos = m + 1;
      if (kind === LINE_BREAK) line += 1;
      if (parts === null) return [prefix === '' ? seg : prefix + seg, kind, seg.length];
      if (seg !== '') parts.push(seg);
      const v = parts.join('');
      return [v, kind, v.length - prefix.length];
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns [value, ended, added].
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null;
    let start = pos + 1;
    let p = pos + 1;
    let closed = -1;
    for (;;) {
      const qi = text.indexOf('"', p);
      const ri = text.indexOf('\r', p);
      const ni = text.indexOf('\n', p);
      let m = -1;
      let kind = 0;
      if (qi !== -1) { m = qi; kind = 0; }
      if (ri !== -1 && (m === -1 || ri < m)) { m = ri; kind = 1; }
      if (ni !== -1 && (m === -1 || ni < m)) { m = ni; kind = 2; }
      if (m === -1) break; // no closing quote before the end of the text
      if (kind === 0) {
        if (m + 1 < len && text.charCodeAt(m + 1) === 34) {
          // Doubled quote: one literal quote in the value.
          if (parts === null) parts = [];
          if (m > start) parts.push(text.slice(start, m));
          parts.push('"');
          p = m + 2;
          start = m + 2;
          continue;
        }
        closed = m;
        break;
      }
      // CR or LF inside quotes: each is one LF in the value, and one more line.
      if (parts === null) parts = [];
      if (m > start) parts.push(text.slice(start, m));
      parts.push('\n');
      line += 1;
      if (kind === 1 && m + 1 < len && text.charCodeAt(m + 1) === 10) {
        p = m + 2;
        start = m + 2;
      } else {
        p = m + 1;
        start = m + 1;
      }
    }
    if (closed === -1) {
      // The quote never closes: it is a literal character, and the text after it is read
      // again as an unquoted field.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    let value;
    if (parts === null) {
      value = text.slice(start, closed);
    } else {
      if (closed > start) parts.push(text.slice(start, closed));
      value = parts.join('');
    }
    pos = closed + 1;
    if (pos >= len) return [value, END, value.length];
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return [value, COMMA, value.length];
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return [value, LINE_BREAK, value.length];
    }
    if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return [value, LINE_BREAK, value.length];
    }
    // What follows the closing quote is appended as it stands, up to the next comma or
    // line break (quote_junk, when the field ends, if anything was appended).
    const junk = readUnquoted(value);
    if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Finishes a record: header, padding/cutting to the first record's width, rows.
  function finish(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  outer: while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record's line holds no quote and no stray CR, so it is one slice
    // plus a split. The line is [pos, nl); a CR right before the LF is the CRLF ending.
    const nl = text.indexOf('\n', pos);
    const le = nl === -1 ? len : nl;
    let segEnd = le;
    if (nl !== -1 && le > pos && text.charCodeAt(le - 1) === 13) segEnd = le - 1;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      const fields = seg.split(',');
      pos = nl === -1 ? len : le + 1;
      line += 1;
      finish(fields);
      continue;
    }

    // Slow path: field by field.
    const fields = [];
    let quoted = false;
    let ended;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const f = readQuoted();
        fields.push(f[0]);
        ended = f[1];
      } else {
        quoted = false;
        const f = readUnquoted('');
        fields.push(f[0]);
        ended = f[1];
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue outer;

    finish(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
