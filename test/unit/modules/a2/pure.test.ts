import { describe, expect, it } from "vitest";
import {
  resolveSort,
  isSortColumn,
  resolveStatusFilter,
  resolveBandFilter,
  resolveIsoDate,
  resolveSearch,
  resolvePage,
  resolvePageSize,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SORT_COLUMN_SQL,
  bandLabel,
  determinationStatusLabel,
} from "../../../../src/modules/a2-dashboard/pure";
import { escapeCsvField, toCsvRow, buildCsv } from "../../../../src/modules/a2-dashboard/csv";
import { crc32, buildZip } from "../../../../src/modules/a2-dashboard/zip";

// T-A2: query-builder whitelisting. "No SQL injection via sort/filter
// params — whitelist columns" (task instructions). Every one of these
// asserts that a hostile/garbage input can never reach past the whitelist —
// it always degrades to a safe, honest default, never an error, never a
// pass-through string.

const SQL_INJECTION_ATTEMPTS = [
  "id; DROP TABLE structures; --",
  "address, (select 1)",
  "1=1",
  "' OR '1'='1",
  "address--",
  "../../etc/passwd",
  "<script>alert(1)</script>",
  "",
  "   ",
];

describe("resolveSort — whitelist, never string pass-through", () => {
  it("only ever returns a SQL fragment from the fixed SORT_COLUMN_SQL map", () => {
    const allowedSqlFragments = new Set(Object.values(SORT_COLUMN_SQL));
    for (const attempt of SQL_INJECTION_ATTEMPTS) {
      const { sql } = resolveSort(attempt, "asc");
      expect(allowedSqlFragments.has(sql)).toBe(true);
      // The raw attempt string itself must never appear in the emitted SQL
      // (skip blank/whitespace-only attempts — trivially "contained" in
      // anything and not a meaningful injection payload).
      const prefix = attempt.split(";")[0]!.trim();
      if (prefix.length > 0) {
        expect(sql).not.toContain(prefix);
      }
    }
  });

  it("defaults to completed_at desc when sort/dir are missing", () => {
    const { column, direction, sql } = resolveSort(undefined, undefined);
    expect(column).toBe("completed_at");
    expect(direction).toBe("desc");
    expect(sql).toBe("la.completed_at");
  });

  it("accepts a real whitelisted column and direction", () => {
    const { column, direction, sql } = resolveSort("ratio", "asc");
    expect(column).toBe("ratio");
    expect(direction).toBe("asc");
    expect(sql).toBe("lc.ratio");
  });

  it("falls back to the column's own default direction on a garbage dir value", () => {
    const { direction } = resolveSort("address", "'; DROP TABLE users; --");
    expect(direction).toBe("asc"); // address's documented default
  });

  it("isSortColumn rejects anything outside the fixed set", () => {
    expect(isSortColumn("address")).toBe(true);
    expect(isSortColumn("id; DROP TABLE structures;")).toBe(false);
    expect(isSortColumn(123)).toBe(false);
    expect(isSortColumn(null)).toBe(false);
  });
});

describe("resolveStatusFilter / resolveBandFilter — whitelist enums", () => {
  it("accepts only the real determination statuses, ALL, or NONE", () => {
    expect(resolveStatusFilter("draft")).toBe("draft");
    expect(resolveStatusFilter("adopted")).toBe("adopted");
    expect(resolveStatusFilter("NONE")).toBe("NONE");
    expect(resolveStatusFilter(undefined)).toBe("ALL");
    for (const attempt of SQL_INJECTION_ATTEMPTS) {
      expect(resolveStatusFilter(attempt)).toBe("ALL");
    }
  });

  it("accepts only the real bands, ALL, or NONE", () => {
    expect(resolveBandFilter("SD")).toBe("SD");
    expect(resolveBandFilter("BORDERLINE")).toBe("BORDERLINE");
    expect(resolveBandFilter("NONE")).toBe("NONE");
    for (const attempt of SQL_INJECTION_ATTEMPTS) {
      expect(resolveBandFilter(attempt)).toBe("ALL");
    }
  });
});

describe("resolveIsoDate — only a literal YYYY-MM-DD passes", () => {
  it("accepts a real ISO date", () => {
    expect(resolveIsoDate("2026-08-17")).toBe("2026-08-17");
  });
  it("rejects anything else, including SQL-shaped strings", () => {
    expect(resolveIsoDate("2026-08-17'; DROP TABLE calculations; --")).toBeNull();
    expect(resolveIsoDate("not-a-date")).toBeNull();
    expect(resolveIsoDate(undefined)).toBeNull();
    expect(resolveIsoDate("")).toBeNull();
  });
});

describe("resolveSearch", () => {
  it("trims and caps length, drops empty", () => {
    expect(resolveSearch("  123 Practice Ln  ")).toBe("123 Practice Ln");
    expect(resolveSearch("   ")).toBeNull();
    expect(resolveSearch(undefined)).toBeNull();
    expect(resolveSearch("x".repeat(500))?.length).toBe(200);
  });
});

describe("resolvePage / resolvePageSize", () => {
  it("defaults invalid page to 1", () => {
    expect(resolvePage(undefined)).toBe(1);
    expect(resolvePage("0")).toBe(1);
    expect(resolvePage("-5")).toBe(1);
    expect(resolvePage("abc")).toBe(1);
    expect(resolvePage("3")).toBe(3);
  });

  it("caps page size at MAX_PAGE_SIZE and defaults invalid input", () => {
    expect(resolvePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePageSize("99999")).toBe(MAX_PAGE_SIZE);
    expect(resolvePageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePageSize("25")).toBe(25);
  });
});

describe("bandLabel / determinationStatusLabel — always a label, never color alone", () => {
  it("labels every band including null", () => {
    expect(bandLabel("SD")).toBe("Substantial damage");
    expect(bandLabel("BORDERLINE")).toContain("requires review");
    expect(bandLabel("NOT_SD")).toBe("Not substantial damage");
    expect(bandLabel(null)).toBe("No calculation");
  });

  it("labels every determination status including null", () => {
    expect(determinationStatusLabel("draft")).toBe("Draft");
    expect(determinationStatusLabel("adopted")).toBe("Adopted");
    expect(determinationStatusLabel("contested")).toBe("Contested");
    expect(determinationStatusLabel("superseded")).toBe("Superseded");
    expect(determinationStatusLabel(null)).toBe("No determination");
  });
});

describe("CSV escaping (RFC 4180, hand-rolled, no dependency)", () => {
  it("passes plain fields through unchanged", () => {
    expect(escapeCsvField("123 Practice Ln")).toBe("123 Practice Ln");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("quotes fields containing a comma, quote, or newline", () => {
    expect(escapeCsvField("Springfield, IL")).toBe('"Springfield, IL"');
    expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("renders null/undefined as an empty cell, never the string 'null'", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("a value that is itself a formula-injection-shaped string is still just quoted/escaped text, not executed", () => {
    expect(escapeCsvField('=1+1,"x"')).toBe(`"=1+1,""x"""`);
  });

  it("toCsvRow joins escaped fields with commas", () => {
    expect(toCsvRow(["a", "b, c", 3])).toBe('a,"b, c",3');
  });

  it("buildCsv produces a header row + data rows with CRLF line endings", () => {
    const csv = buildCsv(["address", "ratio"], [["123 Practice Ln", 0.4889]]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("address,ratio");
    expect(lines[1]).toBe("123 Practice Ln,0.4889");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("buildZip — a real, valid, minimal ZIP archive (STORE method)", () => {
  it("produces bytes starting with the local file header signature", () => {
    const zip = buildZip([{ name: "a.csv", content: Buffer.from("x,y\r\n1,2\r\n", "utf8") }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it("ends with the end-of-central-directory signature and correct entry count", () => {
    const entries = [
      { name: "a.csv", content: Buffer.from("a", "utf8") },
      { name: "b.csv", content: Buffer.from("bb", "utf8") },
    ];
    const zip = buildZip(entries);
    const eocdOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocdOffset).toBeGreaterThan(0);
    const entryCount = zip.readUInt16LE(eocdOffset + 10);
    expect(entryCount).toBe(2);
  });

  it("crc32 is stable and non-trivial", () => {
    const a = crc32(Buffer.from("hello world", "utf8"));
    const b = crc32(Buffer.from("hello world", "utf8"));
    const c = crc32(Buffer.from("hello worlD", "utf8"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBeGreaterThan(0);
  });

  it("an empty archive still produces a valid (empty) EOCD record", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });
});
