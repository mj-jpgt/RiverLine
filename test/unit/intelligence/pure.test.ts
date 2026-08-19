import { describe, expect, it } from "vitest";
import {
  closenessScore,
  minMaxScore,
  zoneSeverityTier,
  zoneSeverityScore,
  computeTriageScore,
  spread,
  sortTriageQueue,
  computeReviewFlags,
} from "@/core/intelligence/pure";
import type { ReviewFlagInput } from "@/core/intelligence/types";
import type { ReviewQueueRow } from "@/core/determination/types";

// G4 intelligence: triage score + review flags. Every fixture here uses
// data the queue already carries (no invented facts) — see
// docs/data-contracts/depth-damage-review.md for why no per-element
// suggester exists to test in the first place.

describe("closenessScore", () => {
  it("scores exactly 1.0 at the 50% legal line", () => {
    expect(closenessScore(0.5)).toBe(1);
  });
  it("scores 0 at 0% or 100% away from the line", () => {
    expect(closenessScore(0)).toBe(0);
    expect(closenessScore(1)).toBe(0);
  });
  it("scores 0 when there is no calculation yet", () => {
    expect(closenessScore(null)).toBe(0);
  });
  it("is linear and symmetric around 50%", () => {
    expect(closenessScore(0.45)).toBeCloseTo(0.9, 5);
    expect(closenessScore(0.55)).toBeCloseTo(0.9, 5);
  });
});

describe("minMaxScore", () => {
  it("scores the max value 1.0 and the min value 0.0", () => {
    expect(minMaxScore(100, 0, 100)).toBe(1);
    expect(minMaxScore(0, 0, 100)).toBe(0);
    expect(minMaxScore(50, 0, 100)).toBeCloseTo(0.5, 5);
  });
  it("scores 0 (neutral fallback) for null value or no spread", () => {
    expect(minMaxScore(null, 0, 100)).toBe(0);
    expect(minMaxScore(50, null, 100)).toBe(0);
    expect(minMaxScore(50, 100, 100)).toBe(0); // max === min
  });
});

describe("zoneSeverityTier / zoneSeverityScore — grounded in FEMA zone definitions", () => {
  it("V-prefixed zones (coastal high-hazard) are the highest tier", () => {
    expect(zoneSeverityTier("V")).toBe(2);
    expect(zoneSeverityTier("VE")).toBe(2);
    expect(zoneSeverityScore("VE")).toBe(1);
  });
  it("A-prefixed zones (inland 1% annual chance) are the middle tier", () => {
    expect(zoneSeverityTier("A")).toBe(1);
    expect(zoneSeverityTier("AE")).toBe(1);
    expect(zoneSeverityScore("AH")).toBe(0.5);
  });
  it("X, D, unknown, and null score the lowest tier", () => {
    expect(zoneSeverityTier("X")).toBe(0);
    expect(zoneSeverityTier("D")).toBe(0);
    expect(zoneSeverityTier(null)).toBe(0);
    expect(zoneSeverityScore("X")).toBe(0);
  });
});

describe("spread", () => {
  it("ignores nulls", () => {
    expect(spread([null, 10, null, 30, 20])).toEqual({ min: 10, max: 30 });
  });
  it("returns nulls when nothing is present", () => {
    expect(spread([null, null])).toEqual({ min: null, max: null });
  });
});

describe("computeTriageScore — exact weighted formula", () => {
  it("weights closeness 0.4, value 0.3, depth 0.2, zone 0.1", () => {
    const breakdown = computeTriageScore(
      0.5, // closeness = 1
      { improvementValue: 100, waterDepthInteriorIn: 10, sfhaZone: "VE" }, // value=1, depth=1, zone=1
      { min: 0, max: 100 },
      { min: 0, max: 10 },
    );
    expect(breakdown.closeness).toBe(1);
    expect(breakdown.valueAtStake).toBe(1);
    expect(breakdown.waterDepth).toBe(1);
    expect(breakdown.zoneSeverity).toBe(1);
    expect(breakdown.total).toBeCloseTo(0.4 + 0.3 + 0.2 + 0.1, 5);
    expect(breakdown.total).toBeCloseTo(1, 5);
  });

  it("scores 0 total when every component is at its floor", () => {
    const breakdown = computeTriageScore(
      0, // closeness = 0
      { improvementValue: 0, waterDepthInteriorIn: 0, sfhaZone: "X" },
      { min: 0, max: 100 },
      { min: 0, max: 10 },
    );
    expect(breakdown.total).toBe(0);
  });
});

function row(overrides: Partial<ReviewQueueRow>): ReviewQueueRow {
  return {
    assessmentId: "a",
    clientId: "c",
    structureId: "s",
    address: "1 Test St",
    completedAt: "2026-01-01T00:00:00.000Z",
    calculationId: null,
    ratio: null,
    thresholdResult: null,
    calculationCount: 0,
    determinationId: null,
    determinationStatus: null,
    ...overrides,
  };
}

describe("sortTriageQueue — bucket order preserved, score refines within it", () => {
  it("keeps BORDERLINE > SD > NOT_SD > no-calculation as the primary key regardless of score", () => {
    const notSd = row({ assessmentId: "not_sd", thresholdResult: "NOT_SD" });
    const sd = row({ assessmentId: "sd", thresholdResult: "SD" });
    const borderline = row({ assessmentId: "borderline", thresholdResult: "BORDERLINE" });
    const scores = new Map([
      ["not_sd", { closeness: 0, valueAtStake: 1, waterDepth: 1, zoneSeverity: 1, total: 1 }],
      ["sd", { closeness: 0, valueAtStake: 0, waterDepth: 0, zoneSeverity: 0, total: 0 }],
      ["borderline", { closeness: 0, valueAtStake: 0, waterDepth: 0, zoneSeverity: 0, total: 0 }],
    ]);
    const sorted = sortTriageQueue([notSd, sd, borderline], scores);
    expect(sorted.map((t) => t.row.assessmentId)).toEqual(["borderline", "sd", "not_sd"]);
  });

  it("within a bucket, higher score sorts first", () => {
    const low = row({ assessmentId: "low", thresholdResult: "BORDERLINE" });
    const high = row({ assessmentId: "high", thresholdResult: "BORDERLINE" });
    const scores = new Map([
      ["low", { closeness: 0.2, valueAtStake: 0, waterDepth: 0, zoneSeverity: 0, total: 0.2 }],
      ["high", { closeness: 0.9, valueAtStake: 0, waterDepth: 0, zoneSeverity: 0, total: 0.9 }],
    ]);
    const sorted = sortTriageQueue([low, high], scores);
    expect(sorted.map((t) => t.row.assessmentId)).toEqual(["high", "low"]);
  });

  it("falls back to oldest-completed-first when scores tie", () => {
    const older = row({ assessmentId: "older", thresholdResult: "SD", completedAt: "2026-01-01T00:00:00.000Z" });
    const newer = row({ assessmentId: "newer", thresholdResult: "SD", completedAt: "2026-01-05T00:00:00.000Z" });
    const scores = new Map([
      ["older", { closeness: 0.5, valueAtStake: 0, waterDepth: 0, zoneSeverity: 0, total: 0.5 }],
      ["newer", { closeness: 0.5, valueAtStake: 0, waterDepth: 0, zoneSeverity: 0, total: 0.5 }],
    ]);
    const sorted = sortTriageQueue([newer, older], scores);
    expect(sorted.map((t) => t.row.assessmentId)).toEqual(["older", "newer"]);
  });
});

// --- Review flags ---------------------------------------------------------

function flagInput(overrides: Partial<ReviewFlagInput>): ReviewFlagInput {
  return {
    occupancyType: "residential",
    ratio: 0.3,
    thresholdResult: "NOT_SD",
    valueSource: "assessed_total",
    waterDepthInteriorIn: 0,
    elements: [],
    photos: [],
    gpsDistanceMeters: null,
    ...overrides,
  };
}

describe("computeReviewFlags — missing photo for a damaged element", () => {
  it("flags an element with damage > 0 and no photo", () => {
    const flags = computeReviewFlags(
      flagInput({
        elements: [{ elementCode: "foundations", damagePct: 40 }],
        photos: [],
      }),
    );
    expect(flags.some((f) => f.code === "missing_photo_for_damaged_element")).toBe(true);
  });

  it("does not flag when the damaged element has a photo", () => {
    const flags = computeReviewFlags(
      flagInput({
        elements: [{ elementCode: "foundations", damagePct: 40 }],
        photos: [{ elementCode: "foundations" }],
      }),
    );
    expect(flags.some((f) => f.code === "missing_photo_for_damaged_element")).toBe(false);
  });

  it("does not flag an undamaged element with no photo", () => {
    const flags = computeReviewFlags(
      flagInput({
        elements: [{ elementCode: "foundations", damagePct: 0 }],
        photos: [],
      }),
    );
    expect(flags.some((f) => f.code === "missing_photo_for_damaged_element")).toBe(false);
  });
});

describe("computeReviewFlags — near a band boundary", () => {
  it("flags a ratio within 2 points of 45%", () => {
    const flags = computeReviewFlags(flagInput({ ratio: 0.44 }));
    expect(flags.some((f) => f.code === "near_band_boundary")).toBe(true);
  });
  it("flags a ratio within 2 points of 55%", () => {
    const flags = computeReviewFlags(flagInput({ ratio: 0.565 }));
    expect(flags.some((f) => f.code === "near_band_boundary")).toBe(true);
  });
  it("does not flag a ratio safely inside a band", () => {
    const flags = computeReviewFlags(flagInput({ ratio: 0.1 }));
    expect(flags.some((f) => f.code === "near_band_boundary")).toBe(false);
  });
  it("does not flag when there is no calculation", () => {
    const flags = computeReviewFlags(flagInput({ ratio: null }));
    expect(flags.some((f) => f.code === "near_band_boundary")).toBe(false);
  });
});

describe("computeReviewFlags — borderline value not backed by appraisal", () => {
  it("flags BORDERLINE with a non-appraisal value source", () => {
    const flags = computeReviewFlags(
      flagInput({ thresholdResult: "BORDERLINE", ratio: 0.5, valueSource: "assessed_total" }),
    );
    expect(flags.some((f) => f.code === "borderline_value_not_appraisal")).toBe(true);
  });
  it("does not flag BORDERLINE backed by an appraisal", () => {
    const flags = computeReviewFlags(flagInput({ thresholdResult: "BORDERLINE", ratio: 0.5, valueSource: "appraisal" }));
    expect(flags.some((f) => f.code === "borderline_value_not_appraisal")).toBe(false);
  });
  it("does not flag a non-borderline ratio regardless of value source", () => {
    const flags = computeReviewFlags(flagInput({ thresholdResult: "SD", ratio: 0.9, valueSource: "assessed_total" }));
    expect(flags.some((f) => f.code === "borderline_value_not_appraisal")).toBe(false);
  });
});

describe("computeReviewFlags — GPS drift from the parcel", () => {
  it("flags a fix farther than ~150m away", () => {
    const flags = computeReviewFlags(flagInput({ gpsDistanceMeters: 300 }));
    expect(flags.some((f) => f.code === "gps_far_from_parcel")).toBe(true);
  });
  it("does not flag a nearby fix", () => {
    const flags = computeReviewFlags(flagInput({ gpsDistanceMeters: 20 }));
    expect(flags.some((f) => f.code === "gps_far_from_parcel")).toBe(false);
  });
  it("does not flag when no GPS/parcel point is available", () => {
    const flags = computeReviewFlags(flagInput({ gpsDistanceMeters: null }));
    expect(flags.some((f) => f.code === "gps_far_from_parcel")).toBe(false);
  });
});

describe("computeReviewFlags — water depth vs. water-line-adjacent element damage", () => {
  it("flags water depth present but zero damage on foundation/floor/interior (residential)", () => {
    const flags = computeReviewFlags(
      flagInput({
        waterDepthInteriorIn: 24,
        elements: [
          { elementCode: "foundations", damagePct: 0 },
          { elementCode: "floor_finish", damagePct: 0 },
          { elementCode: "interior_finish", damagePct: 0 },
          { elementCode: "roof_covering", damagePct: 50 },
        ],
      }),
    );
    expect(flags.some((f) => f.code === "water_depth_no_water_line_damage")).toBe(true);
  });

  it("flags the reverse: water-line damage present but no water depth on file", () => {
    const flags = computeReviewFlags(
      flagInput({
        waterDepthInteriorIn: null,
        elements: [{ elementCode: "foundations", damagePct: 30 }],
      }),
    );
    expect(flags.some((f) => f.code === "water_line_damage_no_water_depth")).toBe(true);
  });

  it("does not flag when depth and water-line damage agree", () => {
    const flags = computeReviewFlags(
      flagInput({
        waterDepthInteriorIn: 24,
        elements: [{ elementCode: "foundations", damagePct: 30 }],
      }),
    );
    expect(flags.some((f) => f.code === "water_depth_no_water_line_damage")).toBe(false);
    expect(flags.some((f) => f.code === "water_line_damage_no_water_depth")).toBe(false);
  });

  it("uses the non-residential water-line element set (foundations, interiors)", () => {
    const flags = computeReviewFlags(
      flagInput({
        occupancyType: "non_residential",
        waterDepthInteriorIn: 24,
        elements: [
          { elementCode: "foundations", damagePct: 0 },
          { elementCode: "interiors", damagePct: 0 },
        ],
      }),
    );
    expect(flags.some((f) => f.code === "water_depth_no_water_line_damage")).toBe(true);
  });
});
