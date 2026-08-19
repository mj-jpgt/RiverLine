// Pure, zero-I/O helpers for G4 intelligence — unit-testable without
// Postgres, same split queries.ts/pure.ts pattern src/core/determination
// already established.

import type { Occupancy } from "@/core/capture";
import { queueBucket, type ReviewQueueRow } from "@/core/determination";
import type {
  ReviewFlag,
  ReviewFlagInput,
  TriageQueueRow,
  TriageScoreBreakdown,
} from "./types";

// --- Triage score components ---------------------------------------------

/** 1.0 at exactly the 50% legal line, falling linearly to 0.0 at 0% or
 * 100% away from it. Null ratio (no calculation yet) scores 0 — there is
 * nothing to prioritize by closeness. */
export function closenessScore(ratio: number | null): number {
  if (ratio === null) return 0;
  const distance = Math.abs(ratio - 0.5);
  return Math.max(0, Math.min(1, 1 - distance / 0.5));
}

/** Where `value` falls between `min` and `max` currently observed in the
 * queue being scored, 0..1. Null value, or a queue with no spread
 * (max === min, including a queue of one), scores 0 — a neutral fallback
 * rather than overstating certainty from a single data point. */
export function minMaxScore(value: number | null, min: number | null, max: number | null): number {
  if (value === null || min === null || max === null) return 0;
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/** FEMA SFHA zone severity tier, grounded in FEMA's own flood-zone
 * definitions (docs/data-contracts/fema-nfhl.md;
 * https://www.fema.gov/about/glossary/flood-zones, retrieved 2026-08-18):
 * V-prefixed zones (V, VE — coastal high-hazard area, wave action) are the
 * most severe SFHA designation; A-prefixed zones (A, AE, AH, AO, AR, A99 —
 * inland 1%-annual-chance floodplain) are SFHA but less severe than V;
 * anything else (X, D, null, unrecognized) is outside the mapped SFHA or
 * unknown. `structures.sfha_zone` stores only the FLD_ZONE code (not
 * ZONE_SUBTY), so this is the finest distinction available from data on
 * file — it does not attempt to separate shaded vs. unshaded Zone X. */
export function zoneSeverityTier(sfhaZone: string | null): 0 | 1 | 2 {
  if (!sfhaZone) return 0;
  const zone = sfhaZone.trim().toUpperCase();
  if (zone.startsWith("V")) return 2;
  if (zone.startsWith("A")) return 1;
  return 0;
}

export function zoneSeverityScore(sfhaZone: string | null): number {
  return zoneSeverityTier(sfhaZone) / 2;
}

const CLOSENESS_WEIGHT = 0.4;
const VALUE_WEIGHT = 0.3;
const DEPTH_WEIGHT = 0.2;
const ZONE_WEIGHT = 0.1;

/** Raw inputs for one queue row's triage score — the fields
 * src/core/intelligence/queries.ts's getTriageQueue pulls per assessment,
 * beyond what src/core/determination's ReviewQueueRow already carries. */
export interface TriageRawInput {
  improvementValue: number | null;
  waterDepthInteriorIn: number | null;
  sfhaZone: string | null;
}

/**
 * priority = 0.4*closeness + 0.3*valueAtStake + 0.2*waterDepth + 0.1*zoneSeverity
 * — the ONE formula this feature implements (mirrored in types.ts's doc
 * comment and shown verbatim, in plain language, in the review queue's
 * "Why this order?" disclosure). `valueSpread`/`depthSpread` are the
 * {min, max} observed across the queue being scored right now (computed by
 * the caller over the full row set before calling this per-row) — read-time
 * only, never cached, never a fixed external constant.
 */
export function computeTriageScore(
  ratio: number | null,
  raw: TriageRawInput,
  valueSpread: { min: number | null; max: number | null },
  depthSpread: { min: number | null; max: number | null },
): TriageScoreBreakdown {
  const closeness = closenessScore(ratio);
  const valueAtStake = minMaxScore(raw.improvementValue, valueSpread.min, valueSpread.max);
  const waterDepth = minMaxScore(raw.waterDepthInteriorIn, depthSpread.min, depthSpread.max);
  const zoneSeverity = zoneSeverityScore(raw.sfhaZone);
  const total =
    CLOSENESS_WEIGHT * closeness + VALUE_WEIGHT * valueAtStake + DEPTH_WEIGHT * waterDepth + ZONE_WEIGHT * zoneSeverity;
  return { closeness, valueAtStake, waterDepth, zoneSeverity, total };
}

/** Min/max helper over a column that may hold nulls — ignores nulls,
 * returns {min: null, max: null} if nothing is present. */
export function spread(values: readonly (number | null)[]): { min: number | null; max: number | null } {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return { min: null, max: null };
  return { min: Math.min(...present), max: Math.max(...present) };
}

/**
 * Sorts the review queue with the SAME bucket order
 * src/core/determination/pure.ts's queueBucket already establishes
 * (BORDERLINE > SD > NOT_SD > no-calculation) as the primary key — that
 * ordering is unchanged and stays the thing a reviewer can rely on. Within
 * a bucket, the triage score (descending — highest priority first) is the
 * new secondary key, replacing the prior "oldest completed_at first"
 * tiebreak. completed_at (oldest first) remains the final tiebreak for two
 * rows with an identical score, so ordering is always fully deterministic.
 */
export function sortTriageQueue(
  rows: readonly ReviewQueueRow[],
  scores: ReadonlyMap<string, TriageScoreBreakdown>,
): TriageQueueRow[] {
  const zero: TriageScoreBreakdown = { closeness: 0, valueAtStake: 0, waterDepth: 0, zoneSeverity: 0, total: 0 };
  return [...rows]
    .map((row): TriageQueueRow => ({ row, score: scores.get(row.assessmentId) ?? zero }))
    .sort((a, b) => {
      const bucketDiff = queueBucket(a.row) - queueBucket(b.row);
      if (bucketDiff !== 0) return bucketDiff;
      const scoreDiff = b.score.total - a.score.total;
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(a.row.completedAt).getTime() - new Date(b.row.completedAt).getTime();
    });
}

// --- Review flags -----------------------------------------------------

const WATER_LINE_ELEMENT_CODES: Record<Occupancy, readonly string[]> = {
  // "foundation/floor/interior" (task instructions) mapped to the actual
  // SDE 3.0 element codes for each occupancy (src/core/capture/elements.ts).
  // Non-residential has no separate "floor_finish" element — "interiors"
  // (Table 3-8) covers interior surface finishes including floors.
  residential: ["foundations", "floor_finish", "interior_finish"],
  non_residential: ["foundations", "interiors"],
};

const NEAR_BOUNDARY_TOLERANCE = 0.02; // 2 percentage points, task instructions
const BORDERLINE_LOWER = 0.45; // src/core/engine/calculate.ts NOT_SD_UPPER_BASIS_POINTS
const BORDERLINE_UPPER = 0.55; // src/core/engine/calculate.ts SD_LOWER_BASIS_POINTS
const GPS_DRIFT_TOLERANCE_M = 150; // task instructions ("~150m")

function flagMissingPhotos(input: ReviewFlagInput): ReviewFlag[] {
  const photographedCodes = new Set(
    input.photos.map((p) => p.elementCode).filter((c): c is string => c !== null),
  );
  const flags: ReviewFlag[] = [];
  for (const el of input.elements) {
    if (el.damagePct > 0 && !photographedCodes.has(el.elementCode)) {
      flags.push({
        code: "missing_photo_for_damaged_element",
        key: `missing_photo_for_damaged_element:${el.elementCode}`,
        sentence: `This element is recorded with ${el.damagePct}% damage but has no photo on file.`,
        whatToCheck: "Confirm the damage percentage against a photo, or note why none was taken.",
      });
    }
  }
  return flags;
}

function flagNearBoundary(ratio: number | null): ReviewFlag[] {
  if (ratio === null) return [];
  const distanceToLower = Math.abs(ratio - BORDERLINE_LOWER);
  const distanceToUpper = Math.abs(ratio - BORDERLINE_UPPER);
  const nearest = Math.min(distanceToLower, distanceToUpper);
  if (nearest > NEAR_BOUNDARY_TOLERANCE) return [];
  return [
    {
      code: "near_band_boundary",
      key: "near_band_boundary",
      sentence: "This ratio is within 2 percentage points of a classification boundary (45% or 55%).",
      whatToCheck: "A small correction to any input could change which band this assessment falls in.",
    },
  ];
}

function flagValueSourceNotAppraisal(thresholdResult: ReviewFlagInput["thresholdResult"], valueSource: string | null): ReviewFlag[] {
  if (thresholdResult !== "BORDERLINE") return [];
  if (valueSource === "appraisal") return [];
  return [
    {
      code: "borderline_value_not_appraisal",
      key: "borderline_value_not_appraisal",
      sentence: "This borderline ratio relies on an assessed value, not an independent appraisal.",
      whatToCheck: "Confirm the assessed value is current, or consider ordering an appraisal.",
    },
  ];
}

function flagGpsDrift(gpsDistanceMeters: number | null): ReviewFlag[] {
  if (gpsDistanceMeters === null) return [];
  if (gpsDistanceMeters <= GPS_DRIFT_TOLERANCE_M) return [];
  return [
    {
      code: "gps_far_from_parcel",
      key: "gps_far_from_parcel",
      sentence: `The recorded GPS fix is about ${Math.round(gpsDistanceMeters)}m from the parcel's location on file.`,
      whatToCheck: "Confirm the assessor was at the correct structure, not a neighboring parcel.",
    },
  ];
}

function flagWaterDepthElementMismatch(input: ReviewFlagInput): ReviewFlag[] {
  const waterLineCodes = new Set(WATER_LINE_ELEMENT_CODES[input.occupancyType]);
  const waterLineElements = input.elements.filter((el) => waterLineCodes.has(el.elementCode));
  if (waterLineElements.length === 0) return [];

  const anyWaterLineDamage = waterLineElements.some((el) => el.damagePct > 0);
  const waterDepthRecorded = input.waterDepthInteriorIn !== null && input.waterDepthInteriorIn > 0;

  if (waterDepthRecorded && !anyWaterLineDamage) {
    return [
      {
        code: "water_depth_no_water_line_damage",
        key: "water_depth_no_water_line_damage",
        sentence: `Water depth of ${input.waterDepthInteriorIn}″ is on file, but foundation/floor/interior elements show no damage.`,
        whatToCheck: "Recheck foundation, floor finish, and interior finish for damage the depth would suggest.",
      },
    ];
  }
  if (!waterDepthRecorded && anyWaterLineDamage) {
    return [
      {
        code: "water_line_damage_no_water_depth",
        key: "water_line_damage_no_water_depth",
        sentence: "Foundation/floor/interior elements show damage, but no interior water depth is on file.",
        whatToCheck: "Confirm whether water depth was observed and should be recorded.",
      },
    ];
  }
  return [];
}

/** Computes every review flag for one assessment, live, from data already on
 * file — never a new fact, never persisted (task requirement). Order here is
 * the render order on the review screen. */
export function computeReviewFlags(input: ReviewFlagInput): ReviewFlag[] {
  return [
    ...flagMissingPhotos(input),
    ...flagNearBoundary(input.ratio),
    ...flagValueSourceNotAppraisal(input.thresholdResult, input.valueSource),
    ...flagGpsDrift(input.gpsDistanceMeters),
    ...flagWaterDepthElementMismatch(input),
  ];
}
