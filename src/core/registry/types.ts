// Registry-local view of `structures`. Deliberately NOT importing
// src/shared/types.ts's `Structure` — that interface predates
// schema/core.sql landing (see its own file comment) and is missing
// several columns this module needs (sq_ft, year_built, prop_class).
// Editing src/shared/types.ts is outside this task's module directory
// (specs/core/tasks.md T-C2: "May read ... src/shared/types.ts" is not
// even listed — registry's allowed module is src/core/registry/ + app/
// registry routes only), so this file defines its own narrow, accurate
// mirror of the columns the registry UI actually reads/writes, traced
// directly to schema/core.sql's `structures` table.

export type OccupancyType = "residential" | "non_residential";

export interface RegistrySearchResult {
  id: string;
  parcelId: string;
  address: string;
  occupancyType: OccupancyType | null;
  sfhaZone: string | null;
  /** DLGF property class code (see docs/data-contracts/dlgf-property-classes.md).
   * Shown alongside parcelId in list rows so two structures that legitimately
   * share one situs address (condos, outbuildings, ROW parcels) are
   * distinguishable, not deduped away — F1 registry coverage task. */
  propClass: string | null;
  /** AVIMPROVE, same field the detail page shows as "Improvement value" —
   * a second differentiator for list rows sharing an address string. */
  improvementValue: number | null;
  /** true when this row was hand-created by an assessor because the parcel
   * was not found in the county ingest (F1 "Structure not found?" path) —
   * never inferred from address alone; sourced from structures.notes'
   * fixed sentinel prefix (see queries.ts MANUAL_ENTRY_MARKER). */
  isManualEntry: boolean;
}

export interface RegistryNearbyResult extends RegistrySearchResult {
  distanceMeters: number;
}

export interface RegistryStructureDetail {
  id: string;
  parcelId: string;
  address: string;
  assessorMarketValue: number | null;
  improvementValue: number | null;
  valueSource: string;
  valueAsOfDate: string | null;
  sfhaZone: string | null;
  firmPanel: string | null;
  occupancyType: OccupancyType | null;
  foundationType: string | null;
  stories: number | null;
  sqFt: number | null;
  yearBuilt: number | null;
  propClass: string | null;
  createdAt: string;
  /** See RegistrySearchResult.isManualEntry. */
  isManualEntry: boolean;
}

// --- Enrichment (autofill from the county record) --------------------------
// A field this app can suggest a value for from the live Hamilton County
// FeatureServer. Deliberately a narrow, explicit list — NOT "any column" —
// so a new structures column never silently becomes suggestible without a
// human deciding the source field mapping for it (AGENTS.md rule 4).
export type EnrichableField =
  | "improvementValue"
  | "sqFt"
  | "yearBuilt"
  | "stories"
  | "occupancyType"
  | "propClass";

export interface EnrichmentSuggestion {
  field: EnrichableField;
  /** Current value is always null when a suggestion exists — accept never
   * overwrites a populated field (see queries.ts applyEnrichment). */
  suggestedValue: string | number;
  /** Human label, e.g. "Improvement value". */
  label: string;
  sourceLabel: string; // e.g. "County assessor record, fetched 2026-08-18"
}

export interface EnrichmentResult {
  available: boolean; // false when the county service could not be reached — degrade silently
  fetchedAt: string | null; // ISO date, only set when available
  suggestions: EnrichmentSuggestion[];
}

export type EnrichmentAcceptedFields = Partial<
  Record<EnrichableField, string | number>
>;

export interface ManualStructureInput {
  address: string;
  parcelId: string | null; // null = unknown, a synthetic id is generated
  occupancyType: OccupancyType | null;
}
