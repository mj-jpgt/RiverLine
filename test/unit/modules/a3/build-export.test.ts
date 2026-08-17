import { describe, expect, it } from "vitest";
import {
  RESIDENTIAL_ELEMENTS,
  NON_RESIDENTIAL_ELEMENTS,
} from "../../../../src/core/capture/elements";
import {
  buildAssessmentExportJson,
  buildElementCsv,
  buildElementCsvRows,
  buildBatchElementCsv,
  buildBatchSummaryCsv,
  buildSummaryCsv,
  ELEMENT_CSV_HEADER,
  SUMMARY_CSV_HEADER,
} from "../../../../src/modules/a3-sde-export/build-export";
import { EXPORT_SCHEMA_VERSION } from "../../../../src/modules/a3-sde-export/types";
import type { ExportAssessmentData, ExportElement } from "../../../../src/modules/a3-sde-export/types";

// Fixture data is hand-built from test/fixtures/engine/cost-table.test-fixture-v0.json
// (TEST-FIXTURE, never real FEMA dollar figures — AGENTS.md rule 5/6) and
// the same damage recipe test/unit/determination/persist.test.ts already
// uses (total_repair_cost 39250 for a 1000 sq ft residential structure),
// so this suite is cross-checkable against that known-good total instead of
// inventing a fresh set of numbers.

const RESIDENTIAL_COST_PER_SQFT: Record<string, number> = {
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

const RESIDENTIAL_DAMAGE: Record<string, number> = {
  foundations: 25,
  superstructure: 50,
  roof_covering: 100,
  interior_finish: 75,
  floor_finish: 50,
  plumbing: 25,
  electrical: 25,
};

function buildResidentialElements(): ExportElement[] {
  const sqFt = 1000;
  return RESIDENTIAL_ELEMENTS.map((def) => {
    const damagePct = RESIDENTIAL_DAMAGE[def.code] ?? 0;
    const baseCostPerSqft: number = RESIDENTIAL_COST_PER_SQFT[def.code] ?? 0;
    const computedCost = (baseCostPerSqft * sqFt * damagePct) / 100;
    return { elementCode: def.code, elementName: def.name, damagePct, baseCostPerSqft, computedCost };
  });
}

const RESIDENTIAL_FIXTURE: ExportAssessmentData = {
  jurisdictionId: "jur-1",
  clientId: "client-abc-123",
  assessmentId: "assessment-1",
  structureId: "structure-1",
  address: "123 Main St",
  parcelId: "PARCEL-001",
  occupancyType: "residential",
  sqFt: 1000,
  stories: 1,
  foundationType: "slab",
  yearBuilt: 1985,
  assessmentDate: "2026-08-10T00:00:00.000Z",
  assessorEmail: "assessor@example.gov",
  gpsLat: 40.0456,
  gpsLng: -86.0086,
  gpsAccuracyM: 5,
  waterDepthInteriorIn: 18,
  waterDepthSource: "observed_line",
  elements: buildResidentialElements(),
  costTableVersion: "TEST-FIXTURE-v0-jur-1",
  costTableSourceCitation:
    "TEST-FIXTURE — arbitrary values for math verification only. Not FEMA data. Never load outside *_test databases.",
  totalRepairCost: 39250,
  marketValueUsed: 100000,
  valueSource: "appraisal",
  ratio: 0.3925,
  thresholdResult: "NOT_SD",
  engineVersion: "1.0.0",
  computedAt: "2026-08-10T12:00:00.000Z",
  determination: {
    status: "adopted",
    adoptedByEmail: "official@example.gov",
    adoptedAt: "2026-08-11T09:00:00.000Z",
    appealDeadlineDate: "2026-09-10",
    notes: null,
  },
};

const NON_RESIDENTIAL_COST_PER_SQFT: Record<string, number> = {
  foundations: 12,
  superstructure: 25,
  roof_covering: 9,
  plumbing: 10,
  electrical: 11,
  interiors: 14,
  hvac: 9,
};

const NON_RESIDENTIAL_DAMAGE: Record<string, number> = {
  foundations: 20,
  superstructure: 40,
  plumbing: 10,
  electrical: 10,
  interiors: 30,
};

function buildNonResidentialElements(): ExportElement[] {
  const sqFt = 2000;
  return NON_RESIDENTIAL_ELEMENTS.map((def) => {
    const damagePct = NON_RESIDENTIAL_DAMAGE[def.code] ?? 0;
    const baseCostPerSqft: number = NON_RESIDENTIAL_COST_PER_SQFT[def.code] ?? 0;
    const computedCost = (baseCostPerSqft * sqFt * damagePct) / 100;
    return { elementCode: def.code, elementName: def.name, damagePct, baseCostPerSqft, computedCost };
  });
}

const NON_RESIDENTIAL_FIXTURE: ExportAssessmentData = {
  jurisdictionId: "jur-1",
  clientId: "client-xyz-789",
  assessmentId: "assessment-2",
  structureId: "structure-2",
  address: "500 Commerce Way",
  parcelId: "PARCEL-900",
  occupancyType: "non_residential",
  sqFt: 2000,
  stories: 2,
  foundationType: "crawlspace",
  yearBuilt: 2001,
  assessmentDate: "2026-08-12T00:00:00.000Z",
  assessorEmail: "assessor2@example.gov",
  gpsLat: null,
  gpsLng: null,
  gpsAccuracyM: null,
  waterDepthInteriorIn: null,
  waterDepthSource: null,
  elements: buildNonResidentialElements(),
  costTableVersion: "TEST-FIXTURE-v0-jur-1",
  costTableSourceCitation:
    "TEST-FIXTURE — arbitrary values for math verification only. Not FEMA data. Never load outside *_test databases.",
  totalRepairCost: 37400,
  marketValueUsed: 1000000,
  valueSource: "assessed_total",
  ratio: 0.0374,
  thresholdResult: "NOT_SD",
  engineVersion: "1.0.0",
  computedAt: "2026-08-12T12:00:00.000Z",
  determination: null,
};

describe("element counts (specs/constitution.md §3 — verified SDE 3.0 set)", () => {
  it("residential fixture has exactly 12 elements", () => {
    expect(RESIDENTIAL_FIXTURE.elements).toHaveLength(12);
  });

  it("non-residential fixture has exactly 7 elements", () => {
    expect(NON_RESIDENTIAL_FIXTURE.elements).toHaveLength(7);
  });
});

describe("buildAssessmentExportJson", () => {
  it("produces the exact expected JSON document for a residential fixture", () => {
    const json = buildAssessmentExportJson(RESIDENTIAL_FIXTURE, "2026-08-17T00:00:00.000Z");

    expect(json.export_schema_version).toBe("1.0");
    expect(json.export_schema_version).toBe(EXPORT_SCHEMA_VERSION);
    expect(json.exported_at).toBe("2026-08-17T00:00:00.000Z");
    expect(json.assessment).toEqual({
      client_id: "client-abc-123",
      assessment_id: "assessment-1",
      structure_id: "structure-1",
      assessment_date: "2026-08-10T00:00:00.000Z",
      assessor_email: "assessor@example.gov",
      gps: { lat: 40.0456, lng: -86.0086, accuracy_m: 5 },
      water_depth_interior_in: 18,
      water_depth_source: "observed_line",
    });
    expect(json.structure).toEqual({
      address: "123 Main St",
      parcel_id: "PARCEL-001",
      occupancy_type: "residential",
      sq_ft: 1000,
      stories: 1,
      foundation_type: "slab",
      year_built: 1985,
    });
    expect(json.elements).toHaveLength(12);
    expect(json.elements[0]).toEqual({
      element_code: "foundations",
      element_name: "Foundations",
      damage_pct: 25,
      base_cost_per_sqft: 10,
      computed_cost: 2500,
    });
    expect(json.calculation).toEqual({
      cost_table_version: "TEST-FIXTURE-v0-jur-1",
      cost_table_source_citation:
        "TEST-FIXTURE — arbitrary values for math verification only. Not FEMA data. Never load outside *_test databases.",
      total_repair_cost: 39250,
      market_value_used: 100000,
      value_source: "appraisal",
      ratio: 0.3925,
      threshold_result: "NOT_SD",
      engine_version: "1.0.0",
      computed_at: "2026-08-10T12:00:00.000Z",
    });
    expect(json.determination).toEqual({
      status: "adopted",
      adopted_by_email: "official@example.gov",
      adopted_at: "2026-08-11T09:00:00.000Z",
      appeal_deadline_date: "2026-09-10",
      notes: null,
    });
  });

  it("emits determination: null honestly when no determination exists yet", () => {
    const json = buildAssessmentExportJson(NON_RESIDENTIAL_FIXTURE, "2026-08-17T00:00:00.000Z");
    expect(json.determination).toBeNull();
    expect(json.elements).toHaveLength(7);
  });

  it("sums the fixture's per-element computed_cost to the known total_repair_cost", () => {
    const json = buildAssessmentExportJson(RESIDENTIAL_FIXTURE, "2026-08-17T00:00:00.000Z");
    const sum = json.elements.reduce((acc, e) => acc + (e.computed_cost ?? 0), 0);
    expect(sum).toBe(39250);
  });
});

describe("buildElementCsv", () => {
  it("produces the exact expected header and row count", () => {
    const csv = buildElementCsv(RESIDENTIAL_FIXTURE);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(ELEMENT_CSV_HEADER.join(","));
    expect(lines).toHaveLength(1 + 12); // header + 12 element rows
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("produces the exact expected first data row", () => {
    const rows = buildElementCsvRows(RESIDENTIAL_FIXTURE);
    expect(rows[0]).toEqual([
      "client-abc-123",
      "assessment-1",
      "123 Main St",
      "PARCEL-001",
      "residential",
      "foundations",
      "Foundations",
      25,
      10,
      2500,
      "TEST-FIXTURE-v0-jur-1",
    ]);
  });

  it("escapes a comma in the address field", () => {
    const withComma: ExportAssessmentData = { ...RESIDENTIAL_FIXTURE, address: "123 Main St, Apt 4" };
    const csv = buildElementCsv(withComma);
    expect(csv).toContain('"123 Main St, Apt 4"');
  });
});

describe("buildSummaryCsv", () => {
  it("produces the exact expected header and single row", () => {
    const csv = buildSummaryCsv(RESIDENTIAL_FIXTURE);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(SUMMARY_CSV_HEADER.join(","));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      [
        "client-abc-123",
        "assessment-1",
        "123 Main St",
        "PARCEL-001",
        "residential",
        "2026-08-10T00:00:00.000Z",
        "TEST-FIXTURE-v0-jur-1",
        "39250",
        "100000",
        "appraisal",
        "0.3925",
        "NOT_SD",
        "1.0.0",
        "adopted",
        "2026-08-11T09:00:00.000Z",
        "2026-09-10",
      ].join(","),
    );
  });

  it("leaves determination fields empty (not the string 'null') when no determination exists", () => {
    const csv = buildSummaryCsv(NON_RESIDENTIAL_FIXTURE);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    // NON_RESIDENTIAL_FIXTURE.determination is null: the three trailing
    // determination columns (status, adopted_at, appeal_deadline_date) must
    // render as empty fields, not the literal string "null".
    const row = lines[1];
    expect(row).toBeDefined();
    expect(row?.endsWith(",,,")).toBe(true);
    expect(row).not.toContain("null");
  });
});

describe("batch CSV builders", () => {
  it("concatenates element rows across multiple assessments under one header", () => {
    const csv = buildBatchElementCsv([RESIDENTIAL_FIXTURE, NON_RESIDENTIAL_FIXTURE]);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(ELEMENT_CSV_HEADER.join(","));
    expect(lines).toHaveLength(1 + 12 + 7);
  });

  it("produces one summary row per assessment in the batch", () => {
    const csv = buildBatchSummaryCsv([RESIDENTIAL_FIXTURE, NON_RESIDENTIAL_FIXTURE]);
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(SUMMARY_CSV_HEADER.join(","));
    expect(lines).toHaveLength(3);
  });

  it("produces a valid header-only CSV for an empty batch", () => {
    const csv = buildBatchElementCsv([]);
    expect(csv).toBe(ELEMENT_CSV_HEADER.join(",") + "\r\n");
  });
});
