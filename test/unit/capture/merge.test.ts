import { describe, expect, it } from "vitest";
import { mergeScalarFields, resolveElementMerge, type ScalarSnapshot } from "../../../app/api/capture/_lib/merge";

// T-C5 added scope: per-field last-write-wins for genuinely concurrent
// multi-device edits of the same assessment (specs/core/tasks.md §2.5,
// docs/testing/live-test-plan.md OT-4). Pure-logic coverage of the merge
// decision; the real Postgres + real HTTP round trip is exercised by
// test/e2e/multi-device-sync.spec.ts.

function scalars(overrides: Partial<ScalarSnapshot>): ScalarSnapshot {
  return {
    gpsLat: null,
    gpsLng: null,
    gpsAccuracyM: null,
    waterDepthInteriorIn: null,
    waterDepthSource: null,
    notes: null,
    deviceCapturedAt: null,
    ...overrides,
  };
}

describe("mergeScalarFields", () => {
  it("first sync ever (existing === null): incoming becomes the row as-is, no changes recorded", () => {
    const incoming = scalars({ notes: "first note", deviceCapturedAt: "2026-01-01T00:00:00.000Z" });
    const result = mergeScalarFields(null, incoming);
    expect(result.merged).toEqual(incoming);
    expect(result.changes).toEqual([]);
    expect(result.incomingIsNewer).toBe(true);
  });

  it("OT-4 core scenario: device B's later edit wins on the field it touched; device A's untouched notes are never regressed by B's null", () => {
    // Device A synced first: sets nothing in notes (never touched it).
    const afterA = scalars({ notes: null, deviceCapturedAt: "2026-01-01T00:00:00.000Z" });
    // Device B syncs second, later device_captured_at, sets notes (A never touched it).
    const fromB = scalars({ notes: "device B note", deviceCapturedAt: "2026-01-02T00:00:00.000Z" });
    const result = mergeScalarFields(afterA, fromB);
    expect(result.merged.notes).toBe("device B note");
    expect(result.changes).toContainEqual({ field: "notes", before: null, after: "device B note" });
  });

  it("an untouched field (incoming null) never clobbers an existing value, even when incoming is newer", () => {
    const existing = scalars({ notes: "existing note", deviceCapturedAt: "2026-01-01T00:00:00.000Z" });
    const incoming = scalars({ notes: null, deviceCapturedAt: "2026-01-05T00:00:00.000Z" });
    const result = mergeScalarFields(existing, incoming);
    expect(result.merged.notes).toBe("existing note");
    expect(result.changes.find((c) => c.field === "notes")).toBeUndefined();
  });

  it("a genuinely new value fills a gap regardless of which batch is 'newer'", () => {
    const existing = scalars({ waterDepthInteriorIn: null, deviceCapturedAt: "2026-01-05T00:00:00.000Z" });
    const incoming = scalars({ waterDepthInteriorIn: 12, deviceCapturedAt: "2026-01-01T00:00:00.000Z" }); // older batch
    const result = mergeScalarFields(existing, incoming);
    expect(result.merged.waterDepthInteriorIn).toBe(12);
  });

  it("when both sides have a value, the STALE (older device_captured_at) batch never overwrites the newer one", () => {
    const existing = scalars({ notes: "newer note", deviceCapturedAt: "2026-01-05T00:00:00.000Z" });
    const staleIncoming = scalars({ notes: "stale retry note", deviceCapturedAt: "2026-01-01T00:00:00.000Z" });
    const result = mergeScalarFields(existing, staleIncoming);
    expect(result.merged.notes).toBe("newer note");
    expect(result.incomingIsNewer).toBe(false);
  });

  it("device_captured_at only ever moves forward (GREATEST of both)", () => {
    const existing = scalars({ deviceCapturedAt: "2026-01-05T00:00:00.000Z" });
    const staleIncoming = scalars({ deviceCapturedAt: "2026-01-01T00:00:00.000Z" });
    const result = mergeScalarFields(existing, staleIncoming);
    expect(result.merged.deviceCapturedAt).toBe("2026-01-05T00:00:00.000Z");
  });
});

describe("resolveElementMerge", () => {
  it("an element missing from existingDamage is always written (fills a real gap)", () => {
    const result = resolveElementMerge({}, [{ elementCode: "foundations", damagePct: 25 }], false);
    expect(result.toWrite).toEqual([{ elementCode: "foundations", damagePct: 25 }]);
    expect(result.changes).toEqual([]);
  });

  it("OT-4 core scenario: element 3 conflict — device B's later edit (75) wins over device A's (50)", () => {
    const existingDamage = { element_3: 50 };
    const result = resolveElementMerge(existingDamage, [{ elementCode: "element_3", damagePct: 75 }], true);
    expect(result.toWrite).toEqual([{ elementCode: "element_3", damagePct: 75 }]);
    expect(result.changes).toEqual([{ elementCode: "element_3", before: 50, after: 75 }]);
  });

  it("a stale (not-newer) incoming element is skipped — never regresses a newer value", () => {
    const existingDamage = { element_3: 75 };
    const result = resolveElementMerge(existingDamage, [{ elementCode: "element_3", damagePct: 50 }], false);
    expect(result.toWrite).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("identical values produce a harmless no-op write and no change record", () => {
    const existingDamage = { element_3: 50 };
    const result = resolveElementMerge(existingDamage, [{ elementCode: "element_3", damagePct: 50 }], true);
    expect(result.toWrite).toEqual([{ elementCode: "element_3", damagePct: 50 }]);
    expect(result.changes).toEqual([]);
  });
});
