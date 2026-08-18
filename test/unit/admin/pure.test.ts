import { describe, expect, it } from "vitest";
import {
  RESIDENTIAL_CODES,
  NON_RESIDENTIAL_CODES,
  isNonEmptyText,
  isValidSourceCitation,
  isValidAppealWindowDays,
  isValidEffectiveDateIso,
  parseCostTablePayload,
} from "../../../src/core/admin/pure";

// Pure, zero-I/O — no Postgres needed (unlike test/unit/admin/persist.test.ts
// / jurisdiction.test.ts). Proves the exact element-code set src/core/admin
// validates against matches docs/data-contracts/sde-cost-tables.md (12
// residential, 7 non-residential), and the shared validator both cost-table
// entry modes (form inputs, pasted/uploaded JSON) funnel through.

describe("element code sets — sourced from src/core/capture, not redeclared", () => {
  it("has exactly the 12 verified residential SDE 3.0 element codes", () => {
    expect(RESIDENTIAL_CODES).toHaveLength(12);
    expect(RESIDENTIAL_CODES).toContain("foundations");
    expect(RESIDENTIAL_CODES).toContain("hvac");
  });

  it("has exactly the 7 verified non-residential SDE 3.0 element codes", () => {
    expect(NON_RESIDENTIAL_CODES).toHaveLength(7);
    expect(NON_RESIDENTIAL_CODES).toContain("interiors");
  });
});

describe("isNonEmptyText / isValidSourceCitation", () => {
  it("rejects blank and whitespace-only text", () => {
    expect(isNonEmptyText("")).toBe(false);
    expect(isNonEmptyText("   ")).toBe(false);
    expect(isNonEmptyText(null)).toBe(false);
    expect(isNonEmptyText(undefined)).toBe(false);
  });

  it("rejects a citation shorter than the placeholder-guard minimum", () => {
    expect(isValidSourceCitation("guide")).toBe(false);
    expect(isValidSourceCitation("n/a")).toBe(false);
  });

  it("accepts a real, descriptive citation", () => {
    expect(isValidSourceCitation("Marshall & Swift Residential Cost Handbook, 2026 ed., p. 42")).toBe(true);
  });
});

describe("isValidAppealWindowDays", () => {
  it("accepts a positive integer", () => {
    expect(isValidAppealWindowDays(30)).toBe(true);
    expect(isValidAppealWindowDays(1)).toBe(true);
  });

  it("rejects zero, negative, non-finite, and non-integer values", () => {
    expect(isValidAppealWindowDays(0)).toBe(false);
    expect(isValidAppealWindowDays(-5)).toBe(false);
    expect(isValidAppealWindowDays(30.5)).toBe(false);
    expect(isValidAppealWindowDays(Number.NaN)).toBe(false);
    expect(isValidAppealWindowDays(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isValidEffectiveDateIso", () => {
  it("accepts a well-formed date", () => {
    expect(isValidEffectiveDateIso("2026-08-17")).toBe(true);
  });

  it("rejects malformed or non-date strings", () => {
    expect(isValidEffectiveDateIso("not-a-date")).toBe(false);
    expect(isValidEffectiveDateIso("2026/08/17")).toBe(false);
    expect(isValidEffectiveDateIso("")).toBe(false);
  });
});

const FULL_RESIDENTIAL: Record<string, number> = {
  foundations: 10,
  superstructure: 20,
  roof_covering: 8,
  exterior_finish: 6,
  interior_finish: 12,
  doors_windows: 7,
  cabinets_countertops: 5,
  floor_finish: 9,
  plumbing: 11,
  electrical: 10,
  appliances: 4,
  hvac: 8,
};

const FULL_NON_RESIDENTIAL: Record<string, number> = {
  foundations: 12,
  superstructure: 25,
  roof_covering: 9,
  plumbing: 10,
  electrical: 11,
  interiors: 14,
  hvac: 9,
};

describe("parseCostTablePayload — the single validator both entry modes share", () => {
  it("accepts a payload with exactly every required code", () => {
    const result = parseCostTablePayload({ residential: FULL_RESIDENTIAL, non_residential: FULL_NON_RESIDENTIAL });
    expect(result.ok).toBe(true);
    expect(result.value?.residential.foundations).toBe(10);
    expect(result.fieldErrors).toEqual([]);
  });

  it("rejects a payload missing one residential code, with a message naming it", () => {
    const { hvac: _drop, ...missingHvac } = FULL_RESIDENTIAL;
    const result = parseCostTablePayload({ residential: missingHvac, non_residential: FULL_NON_RESIDENTIAL });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.some((f) => f.includes("hvac"))).toBe(true);
  });

  it("rejects a payload missing an entire non_residential key", () => {
    const result = parseCostTablePayload({ residential: FULL_RESIDENTIAL });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.length).toBeGreaterThan(0);
  });

  it("rejects a payload with an unrecognized extra element code", () => {
    const result = parseCostTablePayload({
      residential: { ...FULL_RESIDENTIAL, swimming_pool: 3 },
      non_residential: FULL_NON_RESIDENTIAL,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative dollar value", () => {
    const result = parseCostTablePayload({
      residential: { ...FULL_RESIDENTIAL, foundations: -1 },
      non_residential: FULL_NON_RESIDENTIAL,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric value with a per-field message", () => {
    const result = parseCostTablePayload({
      residential: { ...FULL_RESIDENTIAL, foundations: "ten" as unknown as number },
      non_residential: FULL_NON_RESIDENTIAL,
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.some((f) => f.includes("foundations"))).toBe(true);
  });

  it("rejects a completely malformed candidate (not an object)", () => {
    const result = parseCostTablePayload("not an object");
    expect(result.ok).toBe(false);
  });
});
