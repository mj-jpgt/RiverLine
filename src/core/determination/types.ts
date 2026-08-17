// Public types for the M4 determination + adoption workflow (T-C5).
//
// Mirrors schema/core.sql's `determinations`/`calculations`/`audit_log`
// shapes (frozen — never edited). Field names follow the same camelCase
// mapping convention T-C4's app/calculation/_lib/compute.ts already
// established for calculation rows.

import type { ThresholdResult } from "@/core/engine";

export type DeterminationStatus = "draft" | "adopted" | "contested" | "superseded";

/** One row in the official review queue. `thresholdResult`/`ratio` are null
 * when the assessment has no calculation yet (no cost table loaded, or a
 * value gap — specs/constitution.md §2) — that bucket sorts last, per task
 * instructions ("BORDERLINE first, then SD, then NOT_SD, then drafts/
 * no-calculation"). */
export interface ReviewQueueRow {
  assessmentId: string;
  clientId: string;
  structureId: string;
  address: string;
  completedAt: string;
  calculationId: string | null;
  ratio: number | null;
  thresholdResult: ThresholdResult | null;
  calculationCount: number;
  determinationId: string | null;
  determinationStatus: DeterminationStatus | null;
}

export type QueueStatusFilter = "ALL" | "NOT_SD" | "BORDERLINE" | "SD" | "DRAFT_NO_CALC";

export interface ReviewPhoto {
  id: string;
  capturedAt: string;
  gpsLat: number | null;
  gpsLng: number | null;
  caption: string | null;
  /** T-C7 (migrations/0004_photos_element_code.sql): which SDE element this
   * photo documents. 'exterior' for the required exterior shot. null for
   * legacy rows synced before this migration existed — no backfill by
   * inference (AGENTS.md "never invent"); those render in the review
   * screen's "Other photos" section, honestly labeled as unassociated. */
  elementCode: string | null;
}

export interface ReviewElementRow {
  elementCode: string;
  elementName: string;
  damagePct: number;
  baseCost: number;
  computedCost: number;
}

export interface ReviewDeterminationInfo {
  id: string;
  status: DeterminationStatus;
  adoptedByEmail: string | null;
  adoptedAt: string | null;
  appealDeadlineDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ReviewDetail {
  assessmentId: string;
  clientId: string;
  structureId: string;
  address: string;
  occupancyType: "residential" | "non_residential";
  completedAt: string;

  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  waterDepthInteriorIn: number | null;
  waterDepthSource: string | null;
  notes: string | null;

  calculationId: string;
  totalRepairCost: number;
  marketValueUsed: number;
  valueSource: string;
  ratio: number;
  thresholdResult: ThresholdResult;
  costTableVersion: string;
  costTableSourceCitation: string | null;
  engineVersion: string;
  computedAt: string;
  priorCalculationCount: number;

  elements: ReviewElementRow[];
  /** Every photo on file for this assessment, each carrying its
   * `elementCode` (T-C7, migrations/0004_photos_element_code.sql) — 'exterior'
   * for the required exterior shot, an SDE element code for a per-element
   * photo, or null for legacy rows synced before this migration (no
   * backfill by inference). The review screen (app/determination/[clientId])
   * groups these by element; this field stays one flat list — grouping is a
   * presentation concern, not a query concern. */
  photos: ReviewPhoto[];

  determination: ReviewDeterminationInfo | null;
  appealWindowConfiguredDays: number | null;
}

export type ReviewDetailResult =
  | { status: "not_found" }
  | { status: "no_calculation"; structureId: string; address: string }
  | { status: "ok"; detail: ReviewDetail };

export interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  at: string;
}
