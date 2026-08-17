import { describe, expect, it } from "vitest";
import {
  addExteriorPhoto,
  canAdvanceFromStep,
  completeDraft,
  createDraft,
  screenForStep,
  setElementDamage,
  setOccupancy,
  setWaterDepth,
  totalSteps,
} from "@/core/capture/draft";
import { isDraftComplete } from "@/core/capture/types";
import { RESIDENTIAL_ELEMENTS, NON_RESIDENTIAL_ELEMENTS } from "@/core/capture/elements";

const NULL_PREFILL = { occupancyType: null, sqFt: null, stories: null, foundationType: null } as const;

describe("capture draft state machine", () => {
  it("createDraft with unknown occupancy has zero elements until occupancy is chosen", () => {
    const draft = createDraft("structure-1", "juris-1", NULL_PREFILL, "client-1");
    expect(draft.occupancyType).toBeNull();
    expect(draft.elements).toHaveLength(0);
    expect(draft.syncStatus).toBe("draft");
  });

  it("setOccupancy populates the correct 12/7 element set", () => {
    const draft = createDraft("s1", "j1", NULL_PREFILL, "c1");
    const res = setOccupancy(draft, "residential");
    expect(res.elements.map((e) => e.code)).toEqual(RESIDENTIAL_ELEMENTS.map((e) => e.code));

    const nonRes = setOccupancy(draft, "non_residential");
    expect(nonRes.elements.map((e) => e.code)).toEqual(NON_RESIDENTIAL_ELEMENTS.map((e) => e.code));
  });

  it("setOccupancy preserves already-entered damage for shared element codes", () => {
    let draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    draft = setElementDamage(draft, "foundations", 50);
    const switched = setOccupancy(draft, "non_residential");
    const foundations = switched.elements.find((e) => e.code === "foundations");
    expect(foundations?.damagePct).toBe(50);
  });

  it("totalSteps = 1 (attributes) + N elements + 4 (exterior/water/notes/review)", () => {
    const draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    expect(totalSteps(draft)).toBe(1 + 12 + 4);
  });

  it("screenForStep maps every step index to the right screen kind, in order", () => {
    const draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    expect(screenForStep(draft, 0)).toEqual({ kind: "attributes" });
    expect(screenForStep(draft, 1)).toEqual({ kind: "element", index: 0, code: "foundations" });
    expect(screenForStep(draft, 12)).toEqual({ kind: "element", index: 11, code: "hvac" });
    expect(screenForStep(draft, 13)).toEqual({ kind: "exterior_photo" });
    expect(screenForStep(draft, 14)).toEqual({ kind: "water_depth" });
    expect(screenForStep(draft, 15)).toEqual({ kind: "notes" });
    expect(screenForStep(draft, 16)).toEqual({ kind: "review" });
  });

  it("canAdvanceFromStep blocks the attributes screen until occupancy is chosen", () => {
    const draft = createDraft("s1", "j1", NULL_PREFILL, "c1");
    expect(canAdvanceFromStep(draft, 0)).toBe(false);
  });

  it("canAdvanceFromStep blocks an element screen until damage % is set", () => {
    let draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    expect(canAdvanceFromStep(draft, 1)).toBe(false);
    draft = setElementDamage(draft, "foundations", 0);
    expect(canAdvanceFromStep(draft, 1)).toBe(true);
  });

  it("canAdvanceFromStep blocks the exterior-photo screen until a photo exists", () => {
    const draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    const exteriorStep = totalSteps(draft) - 4;
    expect(canAdvanceFromStep(draft, exteriorStep)).toBe(false);
    const withPhoto = addExteriorPhoto(draft, "photo-1");
    expect(canAdvanceFromStep(withPhoto, exteriorStep)).toBe(true);
  });

  it("water depth screen requires both value and source together, or neither, or 'unknown' alone", () => {
    const draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    const waterStep = totalSteps(draft) - 3;
    expect(canAdvanceFromStep(draft, waterStep)).toBe(true); // neither set — fine, optional
    expect(canAdvanceFromStep(setWaterDepth(draft, 18, null), waterStep)).toBe(false); // value w/o source
    expect(canAdvanceFromStep(setWaterDepth(draft, 18, "measured"), waterStep)).toBe(true);
    expect(canAdvanceFromStep(setWaterDepth(draft, null, "unknown"), waterStep)).toBe(true);
  });

  it("review screen only allows completion once every element and the exterior photo are present", () => {
    let draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    const reviewStep = totalSteps(draft) - 1;
    expect(canAdvanceFromStep(draft, reviewStep)).toBe(false);

    for (const el of draft.elements) {
      draft = setElementDamage(draft, el.code, 10);
    }
    expect(canAdvanceFromStep(draft, reviewStep)).toBe(false); // still no exterior photo

    draft = addExteriorPhoto(draft, "photo-ext");
    expect(canAdvanceFromStep(draft, reviewStep)).toBe(true);
  });

  it("completeDraft sets completedAt and queues for sync", () => {
    let draft = createDraft("s1", "j1", { ...NULL_PREFILL, occupancyType: "residential" }, "c1");
    for (const el of draft.elements) draft = setElementDamage(draft, el.code, 0);
    draft = addExteriorPhoto(draft, "photo-ext");
    expect(isDraftComplete(draft)).toBe(false);

    const completed = completeDraft(draft);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.syncStatus).toBe("queued");
    expect(isDraftComplete(completed)).toBe(true);
  });
});
