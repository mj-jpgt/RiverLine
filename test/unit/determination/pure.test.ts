import { describe, expect, it } from "vitest";
import {
  compareQueueRows,
  sortQueueRows,
  filterQueueRows,
  computeAppealDeadlineDate,
  readAppealWindowDays,
  canAdopt,
  canSupersede,
  groupPhotosByElement,
} from "@/core/determination/pure";
import type { ReviewPhoto, ReviewQueueRow } from "@/core/determination/types";
import { RESIDENTIAL_ELEMENTS } from "@/core/capture";

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

describe("compareQueueRows / sortQueueRows — BORDERLINE, then SD, then NOT_SD, then no-calculation", () => {
  it("orders exactly per task instructions regardless of input order", () => {
    const notSd = row({ assessmentId: "not_sd", thresholdResult: "NOT_SD", completedAt: "2026-01-01T00:00:00.000Z" });
    const sd = row({ assessmentId: "sd", thresholdResult: "SD", completedAt: "2026-01-01T00:00:00.000Z" });
    const borderline = row({ assessmentId: "borderline", thresholdResult: "BORDERLINE", completedAt: "2026-01-01T00:00:00.000Z" });
    const noCalc = row({ assessmentId: "no_calc", thresholdResult: null, completedAt: "2026-01-01T00:00:00.000Z" });

    const sorted = sortQueueRows([notSd, noCalc, sd, borderline]);
    expect(sorted.map((r) => r.assessmentId)).toEqual(["borderline", "sd", "not_sd", "no_calc"]);
  });

  it("within a bucket, oldest completed_at sorts first", () => {
    const older = row({ assessmentId: "older", thresholdResult: "SD", completedAt: "2026-01-01T00:00:00.000Z" });
    const newer = row({ assessmentId: "newer", thresholdResult: "SD", completedAt: "2026-01-05T00:00:00.000Z" });
    expect(compareQueueRows(older, newer)).toBeLessThan(0);
    expect(sortQueueRows([newer, older]).map((r) => r.assessmentId)).toEqual(["older", "newer"]);
  });
});

describe("filterQueueRows", () => {
  const rows = [
    row({ assessmentId: "1", thresholdResult: "NOT_SD" }),
    row({ assessmentId: "2", thresholdResult: "BORDERLINE" }),
    row({ assessmentId: "3", thresholdResult: "SD" }),
    row({ assessmentId: "4", thresholdResult: null }),
  ];

  it("ALL returns everything", () => {
    expect(filterQueueRows(rows, "ALL")).toHaveLength(4);
  });

  it("DRAFT_NO_CALC returns only rows with no calculation", () => {
    expect(filterQueueRows(rows, "DRAFT_NO_CALC").map((r) => r.assessmentId)).toEqual(["4"]);
  });

  it("BORDERLINE/SD/NOT_SD filter to exactly that threshold", () => {
    expect(filterQueueRows(rows, "BORDERLINE").map((r) => r.assessmentId)).toEqual(["2"]);
    expect(filterQueueRows(rows, "SD").map((r) => r.assessmentId)).toEqual(["3"]);
    expect(filterQueueRows(rows, "NOT_SD").map((r) => r.assessmentId)).toEqual(["1"]);
  });
});

describe("computeAppealDeadlineDate — NO DEFAULT, ever", () => {
  it("returns null when no appeal-window days are configured (the honest B2 state)", () => {
    expect(computeAppealDeadlineDate("2026-01-01T12:00:00.000Z", null)).toBeNull();
  });

  it("returns null for zero/negative/non-finite configured days rather than inventing a number", () => {
    expect(computeAppealDeadlineDate("2026-01-01T12:00:00.000Z", 0)).toBeNull();
    expect(computeAppealDeadlineDate("2026-01-01T12:00:00.000Z", -5)).toBeNull();
    expect(computeAppealDeadlineDate("2026-01-01T12:00:00.000Z", NaN)).toBeNull();
  });

  it("adds the configured number of days to the adopted date (UTC, date-only)", () => {
    expect(computeAppealDeadlineDate("2026-01-01T12:00:00.000Z", 30)).toBe("2026-01-31");
    expect(computeAppealDeadlineDate("2026-01-01T23:59:00.000Z", 1)).toBe("2026-01-02");
  });
});

describe("readAppealWindowDays — parses jurisdictions.letterhead_config.appeal_window_days safely", () => {
  it("returns null for missing/malformed config, never guesses", () => {
    expect(readAppealWindowDays(null)).toBeNull();
    expect(readAppealWindowDays(undefined)).toBeNull();
    expect(readAppealWindowDays({})).toBeNull();
    expect(readAppealWindowDays({ appeal_window_days: "30" })).toBeNull();
    expect(readAppealWindowDays({ appeal_window_days: 0 })).toBeNull();
    expect(readAppealWindowDays({ appeal_window_days: -1 })).toBeNull();
    expect(readAppealWindowDays("not an object")).toBeNull();
  });

  it("returns the configured number when valid", () => {
    expect(readAppealWindowDays({ appeal_window_days: 30 })).toBe(30);
  });
});

describe("canAdopt / canSupersede", () => {
  it("adoption allowed only when there is no determination yet, or it's still a draft", () => {
    expect(canAdopt(null)).toBe(true);
    expect(canAdopt("draft")).toBe(true);
    expect(canAdopt("adopted")).toBe(false);
    expect(canAdopt("superseded")).toBe(false);
    expect(canAdopt("contested")).toBe(false);
  });

  it("supersede allowed only for adopted or contested determinations", () => {
    expect(canSupersede("adopted")).toBe(true);
    expect(canSupersede("contested")).toBe(true);
    expect(canSupersede("draft")).toBe(false);
    expect(canSupersede("superseded")).toBe(false);
    expect(canSupersede(null)).toBe(false);
  });
});

function photo(overrides: Partial<ReviewPhoto>): ReviewPhoto {
  return {
    id: "p",
    capturedAt: "2026-01-01T00:00:00.000Z",
    gpsLat: null,
    gpsLng: null,
    caption: null,
    elementCode: null,
    ...overrides,
  };
}

describe("groupPhotosByElement — T-C7 review-screen photo grouping", () => {
  it("groups an element photo under its element's verbatim SDE display name", () => {
    const groups = groupPhotosByElement(
      [photo({ id: "1", elementCode: "foundations" })],
      RESIDENTIAL_ELEMENTS,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.code).toBe("foundations");
    expect(groups[0]!.heading).toBe("Foundations");
    expect(groups[0]!.photos.map((p) => p.id)).toEqual(["1"]);
  });

  it("groups element_code = 'exterior' under an 'Exterior' heading", () => {
    const groups = groupPhotosByElement([photo({ id: "1", elementCode: "exterior" })], RESIDENTIAL_ELEMENTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.code).toBe("exterior");
    expect(groups[0]!.heading).toBe("Exterior");
  });

  it("groups null (legacy, pre-migration-0004) photos under 'Other photos' — no inferred association", () => {
    const groups = groupPhotosByElement([photo({ id: "1", elementCode: null })], RESIDENTIAL_ELEMENTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.code).toBe("other");
    expect(groups[0]!.heading).toBe("Other photos");
  });

  it("groups an unrecognized element_code under 'Other photos' too (defensive, never drops a photo)", () => {
    const groups = groupPhotosByElement([photo({ id: "1", elementCode: "not_a_real_element" })], RESIDENTIAL_ELEMENTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.code).toBe("other");
  });

  it("preserves element order, puts Exterior after element groups, Other photos last", () => {
    const photos = [
      photo({ id: "ext", elementCode: "exterior" }),
      photo({ id: "other", elementCode: null }),
      photo({ id: "roof", elementCode: "roof_covering" }),
      photo({ id: "found", elementCode: "foundations" }),
    ];
    const groups = groupPhotosByElement(photos, RESIDENTIAL_ELEMENTS);
    expect(groups.map((g) => g.code)).toEqual(["foundations", "roof_covering", "exterior", "other"]);
  });

  it("omits a group entirely when it has zero photos, rather than an empty heading", () => {
    const groups = groupPhotosByElement([photo({ id: "1", elementCode: "foundations" })], RESIDENTIAL_ELEMENTS);
    expect(groups.find((g) => g.code === "hvac")).toBeUndefined();
    expect(groups.find((g) => g.code === "exterior")).toBeUndefined();
  });

  it("returns an empty array for an empty photo list", () => {
    expect(groupPhotosByElement([], RESIDENTIAL_ELEMENTS)).toEqual([]);
  });
});
