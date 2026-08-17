// Hand-rolled CSV encoding — no dependency (AGENTS.md rule 3: no new
// production dependency without an ADR; csv-stringify et al. are explicitly
// forbidden by this task's instructions, "hand-roll CSV escaping with
// tests"). RFC 4180 quoting: a field is wrapped in double quotes if it
// contains a comma, a double quote, or a newline (\r or \n); an embedded
// double quote is doubled.

/** Formats one value for a CSV cell. `null`/`undefined` become an empty
 * cell (never the string "null" — that would be indistinguishable from a
 * literal value in Excel). Everything else is stringified first. */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvRow(fields: readonly unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** Builds a full CSV document (header + data rows), CRLF line endings per
 * RFC 4180 (Excel — the explicit target audience, spec §6.4 — expects
 * CRLF). No trailing blank line beyond the final CRLF. */
export function buildCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [toCsvRow(headers), ...rows.map((row) => toCsvRow(row))];
  return lines.join("\r\n") + "\r\n";
}
