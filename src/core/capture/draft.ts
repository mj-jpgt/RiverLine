// Pure draft-construction/transition helpers — no IndexedDB, no fetch, no
// `"use client"`. Kept separate from db.ts/sync.ts so this file is trivially
// unit-testable (test/unit/capture/draft.test.ts) without a browser/jsdom
// IndexedDB shim.
import { elementsForOccupancy, type Occupancy } from "./elements";
import type { CaptureDraft, FoundationType, GpsFix, WaterDepthSource } from "./types";

export function newClientId(): string {
  return crypto.randomUUID();
}

export interface StructurePrefill {
  occupancyType: Occupancy | null;
  sqFt: number | null;
  stories: number | null;
  foundationType: FoundationType | null;
}

export function createDraft(
  structureId: string,
  jurisdictionId: string,
  prefill: StructurePrefill,
  clientId: string = newClientId(),
): CaptureDraft {
  const now = new Date().toISOString();
  return {
    clientId,
    structureId,
    jurisdictionId,
    occupancyType: prefill.occupancyType,
    sqFt: prefill.sqFt,
    stories: prefill.stories,
    foundationType: prefill.foundationType,
    gps: null,
    gpsRequestedAt: null,
    elements: prefill.occupancyType
      ? elementsForOccupancy(prefill.occupancyType).map((e) => ({
          code: e.code,
          damagePct: null,
          photoIds: [],
        }))
      : [],
    exteriorPhotoIds: [],
    waterDepthInteriorIn: null,
    waterDepthSource: null,
    notes: "",
    stepIndex: 0,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    syncStatus: "draft",
    syncAttempts: 0,
    lastSyncError: null,
    lastAttemptAt: null,
  };
}

/** Setting occupancy (the forced choice when the parcel left it NULL, or a
 * field correction) re-derives the element list — but preserves any
 * already-entered damage/photo data for element codes shared between the two
 * occupancy element sets (both sets share several codes, e.g. "foundations"). */
export function setOccupancy(draft: CaptureDraft, occupancy: Occupancy): CaptureDraft {
  const existingByCode = new Map(draft.elements.map((e) => [e.code, e]));
  const elements = elementsForOccupancy(occupancy).map((def) => {
    const existing = existingByCode.get(def.code);
    return existing ?? { code: def.code, damagePct: null, photoIds: [] };
  });
  return { ...draft, occupancyType: occupancy, elements };
}

export function setAttributes(
  draft: CaptureDraft,
  attrs: Partial<Pick<CaptureDraft, "sqFt" | "stories" | "foundationType">>,
): CaptureDraft {
  return { ...draft, ...attrs };
}

export function setGps(draft: CaptureDraft, gps: GpsFix | null): CaptureDraft {
  return { ...draft, gps, gpsRequestedAt: new Date().toISOString() };
}

export function setElementDamage(draft: CaptureDraft, code: string, damagePct: number): CaptureDraft {
  return {
    ...draft,
    elements: draft.elements.map((e) => (e.code === code ? { ...e, damagePct } : e)),
  };
}

export function addPhotoToElement(draft: CaptureDraft, code: string, photoId: string): CaptureDraft {
  return {
    ...draft,
    elements: draft.elements.map((e) =>
      e.code === code ? { ...e, photoIds: [...e.photoIds, photoId] } : e,
    ),
  };
}

export function removePhotoFromElement(draft: CaptureDraft, code: string, photoId: string): CaptureDraft {
  return {
    ...draft,
    elements: draft.elements.map((e) =>
      e.code === code ? { ...e, photoIds: e.photoIds.filter((id) => id !== photoId) } : e,
    ),
  };
}

export function addExteriorPhoto(draft: CaptureDraft, photoId: string): CaptureDraft {
  return { ...draft, exteriorPhotoIds: [...draft.exteriorPhotoIds, photoId] };
}

export function removeExteriorPhoto(draft: CaptureDraft, photoId: string): CaptureDraft {
  return { ...draft, exteriorPhotoIds: draft.exteriorPhotoIds.filter((id) => id !== photoId) };
}

export function setWaterDepth(
  draft: CaptureDraft,
  inches: number | null,
  source: WaterDepthSource | null,
): CaptureDraft {
  return { ...draft, waterDepthInteriorIn: inches, waterDepthSource: source };
}

export function setNotes(draft: CaptureDraft, notes: string): CaptureDraft {
  return { ...draft, notes };
}

export function goToStep(draft: CaptureDraft, stepIndex: number): CaptureDraft {
  return { ...draft, stepIndex };
}

export function completeDraft(draft: CaptureDraft): CaptureDraft {
  return { ...draft, completedAt: new Date().toISOString(), syncStatus: "queued", stepIndex: totalSteps(draft) - 1 };
}

/** Flat screen count: 1 (attributes) + N elements + 1 (exterior photo) + 1
 * (water depth) + 1 (notes) + 1 (review). */
export function totalSteps(draft: CaptureDraft): number {
  return 1 + draft.elements.length + 1 + 1 + 1 + 1;
}

export type ScreenKind =
  | { kind: "attributes" }
  | { kind: "element"; index: number; code: string }
  | { kind: "exterior_photo" }
  | { kind: "water_depth" }
  | { kind: "notes" }
  | { kind: "review" };

export function screenForStep(draft: CaptureDraft, stepIndex: number): ScreenKind {
  if (stepIndex === 0) return { kind: "attributes" };
  const elementsEnd = 1 + draft.elements.length;
  if (stepIndex < elementsEnd) {
    const index = stepIndex - 1;
    const element = draft.elements[index];
    return { kind: "element", index, code: element ? element.code : "" };
  }
  if (stepIndex === elementsEnd) return { kind: "exterior_photo" };
  if (stepIndex === elementsEnd + 1) return { kind: "water_depth" };
  if (stepIndex === elementsEnd + 2) return { kind: "notes" };
  return { kind: "review" };
}

export function canAdvanceFromStep(draft: CaptureDraft, stepIndex: number): boolean {
  const screen = screenForStep(draft, stepIndex);
  switch (screen.kind) {
    case "attributes":
      return draft.occupancyType !== null;
    case "element": {
      const element = draft.elements[screen.index];
      return !!element && element.damagePct !== null;
    }
    case "exterior_photo":
      return draft.exteriorPhotoIds.length > 0;
    case "water_depth":
      // Water depth is optional data (unknown/not observed is a legitimate
      // field state — build spec §11 water_depth_source includes 'unknown').
      // A source must be picked if a depth value was entered, or vice versa,
      // to avoid a half-filled, ambiguous record.
      return (
        (draft.waterDepthInteriorIn === null && draft.waterDepthSource === null) ||
        (draft.waterDepthInteriorIn !== null && draft.waterDepthSource !== null) ||
        draft.waterDepthSource === "unknown"
      );
    case "notes":
      return true;
    case "review":
      return draft.elements.every((e) => e.damagePct !== null) && draft.exteriorPhotoIds.length > 0;
  }
}
