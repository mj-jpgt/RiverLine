// Pure export builders — zero I/O, same discipline as src/core/engine.
// Given an already-assembled ExportAssessmentData (see queries.ts for how
// that gets fetched from the database), produce the per-assessment JSON
// document and the two CSV row shapes (per-element, summary). No database,
// no fetch, no fs — fully unit-testable against fixture data.

import { buildCsv } from "./csv";
import { EXPORT_SCHEMA_VERSION } from "./types";
import type { AssessmentExportJson, ExportAssessmentData } from "./types";

/** Build the per-assessment JSON export document (export_schema_version
 * "1.0"). `exportedAt` is passed in by the caller (route handler) rather
 * than read from Date.now() here, so this function stays pure and
 * deterministic for tests. */
export function buildAssessmentExportJson(
  data: ExportAssessmentData,
  exportedAt: string,
): AssessmentExportJson {
  return {
    export_schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: exportedAt,
    assessment: {
      client_id: data.clientId,
      assessment_id: data.assessmentId,
      structure_id: data.structureId,
      assessment_date: data.assessmentDate,
      assessor_email: data.assessorEmail,
      gps: { lat: data.gpsLat, lng: data.gpsLng, accuracy_m: data.gpsAccuracyM },
      water_depth_interior_in: data.waterDepthInteriorIn,
      water_depth_source: data.waterDepthSource,
    },
    structure: {
      address: data.address,
      parcel_id: data.parcelId,
      occupancy_type: data.occupancyType,
      sq_ft: data.sqFt,
      stories: data.stories,
      foundation_type: data.foundationType,
      year_built: data.yearBuilt,
    },
    elements: data.elements.map((e) => ({
      element_code: e.elementCode,
      element_name: e.elementName,
      damage_pct: e.damagePct,
      base_cost_per_sqft: e.baseCostPerSqft,
      computed_cost: e.computedCost,
    })),
    calculation: {
      cost_table_version: data.costTableVersion,
      cost_table_source_citation: data.costTableSourceCitation,
      total_repair_cost: data.totalRepairCost,
      market_value_used: data.marketValueUsed,
      value_source: data.valueSource,
      ratio: data.ratio,
      threshold_result: data.thresholdResult,
      engine_version: data.engineVersion,
      computed_at: data.computedAt,
    },
    determination: data.determination
      ? {
          status: data.determination.status,
          adopted_by_email: data.determination.adoptedByEmail,
          adopted_at: data.determination.adoptedAt,
          appeal_deadline_date: data.determination.appealDeadlineDate,
          notes: data.determination.notes,
        }
      : null,
  };
}

export const ELEMENT_CSV_HEADER = [
  "client_id",
  "assessment_id",
  "address",
  "parcel_id",
  "occupancy_type",
  "element_code",
  "element_name",
  "damage_pct",
  "base_cost_per_sqft",
  "computed_cost",
  "cost_table_version",
];

/** One row per assessment-element. Flat, Excel-safe. */
export function buildElementCsvRows(data: ExportAssessmentData): Array<Array<string | number | null>> {
  return data.elements.map((e) => [
    data.clientId,
    data.assessmentId,
    data.address,
    data.parcelId,
    data.occupancyType,
    e.elementCode,
    e.elementName,
    e.damagePct,
    e.baseCostPerSqft,
    e.computedCost,
    data.costTableVersion,
  ]);
}

/** Full per-element CSV for one assessment (header + one row per element). */
export function buildElementCsv(data: ExportAssessmentData): string {
  return buildCsv(ELEMENT_CSV_HEADER, buildElementCsvRows(data));
}

/** Batch per-element CSV across multiple assessments — same header, rows
 * concatenated in the order given. */
export function buildBatchElementCsv(dataset: ExportAssessmentData[]): string {
  const rows = dataset.flatMap((d) => buildElementCsvRows(d));
  return buildCsv(ELEMENT_CSV_HEADER, rows);
}

export const SUMMARY_CSV_HEADER = [
  "client_id",
  "assessment_id",
  "address",
  "parcel_id",
  "occupancy_type",
  "assessment_date",
  "cost_table_version",
  "total_repair_cost",
  "market_value_used",
  "value_source",
  "ratio",
  "threshold_result",
  "engine_version",
  "determination_status",
  "adopted_at",
  "appeal_deadline_date",
];

/** One summary row per assessment: the calculation + determination facts,
 * without the per-element breakdown (that's the element CSV's job). */
export function buildSummaryCsvRow(data: ExportAssessmentData): Array<string | number | null> {
  return [
    data.clientId,
    data.assessmentId,
    data.address,
    data.parcelId,
    data.occupancyType,
    data.assessmentDate,
    data.costTableVersion,
    data.totalRepairCost,
    data.marketValueUsed,
    data.valueSource,
    data.ratio,
    data.thresholdResult,
    data.engineVersion,
    data.determination?.status ?? null,
    data.determination?.adoptedAt ?? null,
    data.determination?.appealDeadlineDate ?? null,
  ];
}

/** Full summary CSV for one assessment (header + a single row). */
export function buildSummaryCsv(data: ExportAssessmentData): string {
  return buildCsv(SUMMARY_CSV_HEADER, [buildSummaryCsvRow(data)]);
}

/** Batch summary CSV across multiple assessments — one row per assessment. */
export function buildBatchSummaryCsv(dataset: ExportAssessmentData[]): string {
  return buildCsv(SUMMARY_CSV_HEADER, dataset.map(buildSummaryCsvRow));
}
