// Hand-rolled CSV escaping (no new dependency, AGENTS.md rule 3). Excel-safe:
// CRLF line endings, RFC4180-style quoting. Pure functions, unit-tested
// directly against edge cases (commas, quotes, newlines in notes/citations).

/** Escape a single CSV field. Quotes the field if it contains a comma, a
 * double quote, a CR, or an LF; doubles any internal double quotes. `null`/
 * `undefined` become an empty field (never the literal string "null"). */
export function csvEscapeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** One CSV row (no trailing newline) from a list of raw field values. */
export function toCsvRow(fields: Array<string | number | null | undefined>): string {
  return fields.map(csvEscapeField).join(",");
}

/** A full CSV document: header row + data rows, CRLF-joined, trailing CRLF —
 * the Excel-safe convention. `rows` are raw field arrays, not pre-escaped. */
export function buildCsv(
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
  return lines.join("\r\n") + "\r\n";
}
