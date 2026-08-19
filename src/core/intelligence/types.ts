// Public types for G4 "pragmatic intelligence": triage ordering, review
// flags, and an exposure rollup — all arithmetic and sorting over data
// RiverLine already holds, never a fabricated value. See
// docs/data-contracts/depth-damage-review.md for why this module does NOT
// suggest per-element damage percentages (the one thing that would have
// invented a legal-methodology fact), and docs/journal/2026-08-18-g4-intelligence.md
// for the design writeup.

import type { ThresholdResult } from "@/core/engine";
import type { DeterminationStatus, ReviewQueueRow } from "@/core/determination";

// --- Triage score -------------------------------------------------------
//
// priority = 0.4*closeness + 0.3*valueAtStake + 0.2*waterDepth + 0.1*zoneSeverity
// (src/core/intelligence/pure.ts computeTriageScore — the ONE place this
// formula is implemented; every number below is in [0, 1] before weighting,
// and the weighted total is also [0, 1]). This is a queue ORDERING heuristic
// only: it is never persisted, never shown as a fact about the structure,
// and never feeds `calculations` or `determinations` (AGENTS.md rules 4/10).
// It only refines order WITHIN the existing BORDERLINE > SD > NOT_SD >
// no-calculation bucket order (src/core/determination/pure.ts queueBucket),
// which stays the primary sort key.
export interface TriageScoreBreakdown {
  /** How close the ratio is to the legal 50% line, 1.0 = exactly 50%, 0.0 =
   * 0% or 100% away. Null ratio (no calculation yet) scores 0. */
  closeness: number;
  /** Where this structure's improvement value (AVIMPROVE, `structures.improvement_value`)
   * falls between the smallest and largest improvement value currently in
   * the queue being scored, 0..1. Null/no-spread scores 0. */
  valueAtStake: number;
  /** Where this assessment's recorded interior water depth falls between the
   * smallest and largest recorded depth currently in the queue, 0..1.
   * Null/no-spread scores 0. */
  waterDepth: number;
  /** FEMA SFHA zone severity tier / 2: V or VE (coastal high-hazard) = 1.0,
   * any A-prefixed zone (A/AE/AH/AO/AR/A99, 1% annual chance inland) = 0.5,
   * X/D/unknown/null = 0. Source: docs/data-contracts/fema-nfhl.md and
   * https://www.fema.gov/about/glossary/flood-zones (retrieved 2026-08-18). */
  zoneSeverity: number;
  /** 0.4*closeness + 0.3*valueAtStake + 0.2*waterDepth + 0.1*zoneSeverity. */
  total: number;
}

/** One row of the triage-scored review queue: the existing determination
 * queue row plus its computed priority. */
export interface TriageQueueRow {
  row: ReviewQueueRow;
  score: TriageScoreBreakdown;
}

// --- Review flags ---------------------------------------------------------
//
// Computed live, read time only, never persisted (task requirement). Each
// flag is ONE plain sentence plus ONE "what to check" instruction — flags
// inform the reviewer, they never block AdoptAction (AGENTS.md rule 12: the
// tool proposes, the official adopts).
export type ReviewFlagCode =
  | "missing_photo_for_damaged_element"
  | "near_band_boundary"
  | "borderline_value_not_appraisal"
  | "gps_far_from_parcel"
  | "water_depth_no_water_line_damage"
  | "water_line_damage_no_water_depth";

export interface ReviewFlag {
  code: ReviewFlagCode;
  /** Stable, human-scannable key for React lists / tests — never rendered. */
  key: string;
  sentence: string;
  whatToCheck: string;
}

/** Minimal shape computeReviewFlags needs — deliberately structural rather
 * than importing ReviewDetail's every field, so this module stays decoupled
 * from determination's full type and only needs a type-only import for
 * clarity below. */
export interface ReviewFlagElementInput {
  elementCode: string;
  damagePct: number;
}

export interface ReviewFlagPhotoInput {
  elementCode: string | null;
}

export interface ReviewFlagInput {
  occupancyType: "residential" | "non_residential";
  ratio: number | null;
  thresholdResult: ThresholdResult | null;
  valueSource: string | null;
  waterDepthInteriorIn: number | null;
  elements: readonly ReviewFlagElementInput[];
  photos: readonly ReviewFlagPhotoInput[];
  /** Distance in meters between the assessment's recorded GPS fix and the
   * structure's stored parcel-centroid point, or null if either point is
   * missing. Computed by src/core/intelligence/queries.ts getGpsDistanceMeters
   * (a single ST_Distance point comparison — not a spatial join, see that
   * function's doc comment for why this is serving-path-legal per AGENTS.md's
   * geospatial rule). */
  gpsDistanceMeters: number | null;
}

// --- Exposure rollup ------------------------------------------------------

/** "Unreviewed" = latest determination for the structure's latest completed
 * assessment is either absent or still `draft` — i.e., no official has
 * adopted (or contested) a finding yet. `adopted`/`contested`/`superseded`
 * rows are excluded: they have already had official attention, even if a
 * new draft is pending after a supersede (that new draft DOES count again,
 * correctly, as unreviewed). */
export interface ExposureRollup {
  unreviewedCount: number;
  /** Sum of `calculations.total_repair_cost` (latest calculation per
   * structure) across every unreviewed row. Null when there is nothing
   * unreviewed with a calculation on file — never a fabricated 0 standing
   * in for "no data" (specs/constitution.md's established pattern). */
  unreviewedExposureTotal: number | null;
}

export type { DeterminationStatus };
