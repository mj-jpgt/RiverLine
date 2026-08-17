// T-A3 — SDE 3.0-structured export. Public shapes.
//
// This mirrors the VERIFIED SDE 3.0 element structure (12 residential / 7
// non-residential elements, docs/data-contracts/sde-cost-tables.md, FEMA
// P-784 Tables 3-6 / 3-8) — not the build spec's stale 8-item list
// (specs/constitution.md §3). Field-level mapping to the real SDE desktop
// tool's internal storage is recorded, with citations, in
// docs/data-contracts/sde-export-mapping.md; this module never claims that
// the export imports into SDE without re-keying (see that doc's "IMPORTANT"
// section) — it only claims "SDE 3.0-structured."

export const EXPORT_SCHEMA_VERSION = "1.0";

export type Occupancy = "residential" | "non_residential";
export type ThresholdResult = "SD" | "NOT_SD" | "BORDERLINE";
export type DeterminationStatus = "draft" | "adopted" | "contested" | "superseded";

/** One element's damage record, using the exact verified element code/name
 * pair from src/core/capture (elementsForOccupancy) — never an invented
 * element name. */
export interface ExportElement {
  elementCode: string;
  elementName: string;
  damagePct: number;
  baseCostPerSqft: number | null;
  computedCost: number | null;
}

export interface ExportDetermination {
  status: DeterminationStatus;
  adoptedByEmail: string | null;
  adoptedAt: string | null;
  appealDeadlineDate: string | null;
  notes: string | null;
}

/**
 * Everything the export needs for one assessment-with-calculation. Assembled
 * by queries.ts from real rows (tenant-scoped); consumed by the pure
 * builders in build-export.ts. Kept as one flat shape so the JSON/CSV
 * builders stay pure functions with no I/O (same discipline as
 * src/core/engine).
 */
export interface ExportAssessmentData {
  jurisdictionId: string;
  clientId: string;
  assessmentId: string;
  structureId: string;

  // Structure attributes (schema/core.sql: structures)
  address: string;
  parcelId: string;
  occupancyType: Occupancy;
  sqFt: number | null;
  stories: number | null;
  foundationType: string | null;
  yearBuilt: number | null;

  // Assessment metadata (schema/core.sql: assessments)
  assessmentDate: string; // completed_at, ISO timestamp
  assessorEmail: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  waterDepthInteriorIn: number | null;
  waterDepthSource: string | null;

  // Per-element damage (schema/core.sql: assessment_elements), exact 12/7 set
  elements: ExportElement[];

  // Calculation facts (schema/core.sql: calculations)
  costTableVersion: string;
  costTableSourceCitation: string | null;
  totalRepairCost: number;
  marketValueUsed: number;
  valueSource: string;
  ratio: number;
  thresholdResult: ThresholdResult;
  engineVersion: string;
  computedAt: string;

  // Determination + adoption facts (schema/core.sql: determinations)
  determination: ExportDetermination | null;
}

/** Per-assessment JSON export document — machine-readable, versioned. */
export interface AssessmentExportJson {
  export_schema_version: string;
  exported_at: string;
  assessment: {
    client_id: string;
    assessment_id: string;
    structure_id: string;
    assessment_date: string;
    assessor_email: string | null;
    gps: { lat: number | null; lng: number | null; accuracy_m: number | null };
    water_depth_interior_in: number | null;
    water_depth_source: string | null;
  };
  structure: {
    address: string;
    parcel_id: string;
    occupancy_type: Occupancy;
    sq_ft: number | null;
    stories: number | null;
    foundation_type: string | null;
    year_built: number | null;
  };
  elements: Array<{
    element_code: string;
    element_name: string;
    damage_pct: number;
    base_cost_per_sqft: number | null;
    computed_cost: number | null;
  }>;
  calculation: {
    cost_table_version: string;
    cost_table_source_citation: string | null;
    total_repair_cost: number;
    market_value_used: number;
    value_source: string;
    ratio: number;
    threshold_result: ThresholdResult;
    engine_version: string;
    computed_at: string;
  };
  determination: {
    status: DeterminationStatus;
    adopted_by_email: string | null;
    adopted_at: string | null;
    appeal_deadline_date: string | null;
    notes: string | null;
  } | null;
}
