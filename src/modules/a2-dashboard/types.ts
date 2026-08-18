// Public types for the T-A2 administrator dashboard (status overview +
// caseload table + CSV export). Field names follow the same camelCase
// mapping convention src/core/determination/types.ts already established.

export type DeterminationStatus = "draft" | "adopted" | "contested" | "superseded";
export type CalculationBand = "SD" | "BORDERLINE" | "NOT_SD";

/** Row entity is the STRUCTURE (task instructions: "caseload table: all
 * structures with assessment/calculation/determination state") — one row
 * per structure, carrying its latest completed assessment's latest
 * calculation and latest determination (if any exist). A structure that has
 * never been assessed still appears, with every latter field null. */
export interface CaseloadRow {
  structureId: string;
  parcelId: string;
  address: string;
  assessmentId: string | null;
  completedAt: string | null;
  ratio: number | null;
  band: CalculationBand | null;
  marketValueUsed: number | null;
  valueSource: string | null;
  costTableVersion: string | null;
  determinationId: string | null;
  determinationStatus: DeterminationStatus | null;
  adoptedAt: string | null;
}

export interface CaseloadPage {
  rows: CaseloadRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** Counts by determination status — the four canonical statuses on the
 * LATEST determination per structure, plus an honest fifth bucket for
 * structures with no determination on file at all (never folded into
 * "draft" — a structure that was never reviewed is a different fact than
 * one that was reviewed and left as a draft). */
export interface DeterminationStatusCounts {
  draft: number;
  adopted: number;
  contested: number;
  superseded: number;
  none: number;
}

/** Counts by calculation band — the LATEST calculation per structure's
 * latest completed assessment. "noCalculation" covers both "assessed but no
 * cost table was loaded / calculation exists yet" and "never assessed" —
 * both are honestly "no ratio to show," per specs/constitution.md #2. */
export interface CalculationBandCounts {
  SD: number;
  BORDERLINE: number;
  NOT_SD: number;
  noCalculation: number;
}

export interface DashboardCounts {
  byDeterminationStatus: DeterminationStatusCounts;
  byCalculationBand: CalculationBandCounts;
  totalStructures: number;
}

export type CaseloadSortColumn = "address" | "parcel_id" | "ratio" | "completed_at" | "status" | "band";
export type SortDirection = "asc" | "desc";

export type BandFilter = CalculationBand | "NONE" | "ALL";
export type StatusFilter = DeterminationStatus | "NONE" | "ALL";

export interface CaseloadFilters {
  search: string | null;
  status: StatusFilter;
  band: BandFilter;
  dateFrom: string | null; // ISO date (completed_at >=)
  dateTo: string | null; // ISO date (completed_at <=)
}

export interface CaseloadQuery {
  filters: CaseloadFilters;
  sort: CaseloadSortColumn;
  direction: SortDirection;
  page: number;
  pageSize: number;
}

/** One table's worth of rows for the full records-request export (spec
 * §7.6). `columns` is the literal ordered column list used both for the
 * header row and to read each value out of `rows` — kept explicit rather
 * than trusting object key order. */
export interface ExportTable {
  tableName: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

// --- Operational summary (V5 task 3) ---------------------------------
//
// "The numbers an EMA/county would actually ask for during an event": the
// existing status/band counts (above) plus a damage-category cross-break by
// occupancy type, total computed repair-cost exposure, and how many SD
// determinations are actually ADOPTED (not merely calculated) — the
// difference matters because "computed SD" is a proposal and "adopted SD"
// is the official's actual decision of record (AGENTS.md rule 12: the
// system proposes, the official adopts).

export type Occupancy = "residential" | "non_residential" | "unknown";

/** Same shape as CalculationBandCounts, reused per occupancy bucket so an
 * EMA can see "how many residential vs. non-residential structures, and at
 * what severity" — the two FEMA program tracks (Individual Assistance vs.
 * Public Assistance) split along exactly this line. */
export interface OccupancyBandCounts {
  residential: CalculationBandCounts;
  nonResidential: CalculationBandCounts;
  unknownOccupancy: CalculationBandCounts;
}

/** Sum of `calculations.total_repair_cost` (latest calculation per
 * structure), in dollars, broken out by band. `null` when no calculation in
 * that band exists yet — never a fabricated 0 standing in for "no data",
 * per specs/constitution.md's "explicit runtime states, not filled in"
 * pattern used throughout this project. */
export interface RepairCostTotals {
  total: number | null;
  SD: number | null;
  BORDERLINE: number | null;
  NOT_SD: number | null;
}

export interface OperationalSummary {
  totalStructures: number;
  byDeterminationStatus: DeterminationStatusCounts;
  byCalculationBand: CalculationBandCounts;
  byOccupancyAndBand: OccupancyBandCounts;
  totalComputedRepairCost: RepairCostTotals;
  adoptedSdCount: number;
}
