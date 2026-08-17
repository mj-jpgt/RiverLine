import { describe, expect, it } from "vitest";
import { buildCsv, csvEscapeField, toCsvRow } from "../../../../src/modules/a3-sde-export/csv";

describe("csvEscapeField", () => {
  it("passes through a plain field unchanged", () => {
    expect(csvEscapeField("foundations")).toBe("foundations");
  });

  it("passes through numbers as strings", () => {
    expect(csvEscapeField(42)).toBe("42");
    expect(csvEscapeField(0)).toBe("0");
  });

  it("returns empty string for null/undefined, never the literal 'null'", () => {
    expect(csvEscapeField(null)).toBe("");
    expect(csvEscapeField(undefined)).toBe("");
  });

  it("quotes a field containing a comma", () => {
    expect(csvEscapeField("123 Main St, Apt 4")).toBe('"123 Main St, Apt 4"');
  });

  it("quotes and doubles internal double quotes", () => {
    expect(csvEscapeField('Notes: 6" of water in basement')).toBe(
      '"Notes: 6"" of water in basement"',
    );
  });

  it("quotes a field containing a newline", () => {
    expect(csvEscapeField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a field containing a carriage return", () => {
    expect(csvEscapeField("line one\rline two")).toBe('"line one\rline two"');
  });

  it("quotes a field with comma, quote, and newline all together", () => {
    const input = 'Assessor said, "6 inches," then left.\nFollow up needed.';
    const escaped = csvEscapeField(input);
    expect(escaped.startsWith('"')).toBe(true);
    expect(escaped.endsWith('"')).toBe(true);
    // every literal quote inside is doubled
    expect(escaped).toBe(
      '"Assessor said, ""6 inches,"" then left.\nFollow up needed."',
    );
  });
});

describe("toCsvRow", () => {
  it("joins escaped fields with commas", () => {
    expect(toCsvRow(["a", "b, c", 3, null])).toBe('a,"b, c",3,');
  });
});

describe("buildCsv", () => {
  it("builds header + rows, CRLF-joined, trailing CRLF", () => {
    const csv = buildCsv(["a", "b"], [["1", "2"], ["3, comma", "4"]]);
    expect(csv).toBe('a,b\r\n1,2\r\n"3, comma",4\r\n');
  });

  it("produces an empty-but-valid CSV (header only) for zero rows", () => {
    const csv = buildCsv(["a", "b"], []);
    expect(csv).toBe("a,b\r\n");
  });
});
