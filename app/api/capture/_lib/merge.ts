// Pure per-field / per-element merge decisions for the multi-device sync
// case (T-C5 added scope, specs/core/tasks.md §2.5, live-test-plan OT-4).
//
// The frozen schema (schema/core.sql) has exactly one `device_captured_at`
// timestamp per assessment row — not one per scalar field, not one per
// assessment_elements row. True independent per-field timestamps aren't
// representable without a schema change, which is out of scope (AGENTS.md
// rule 1). This module implements the closest honest approximation:
//
//   - A field/element that the incoming device never touched (null, or
//     absent from its local snapshot) NEVER overwrites whatever is already
//     on file, regardless of arrival order or timestamp — this is what
//     makes it "per field," not "whole record": one device's sync can never
//     silently discard another device's data it didn't touch.
//   - A field/element that is currently missing (null / no row yet) is
//     always filled in by the first device to report it, regardless of
//     which device's batch timestamp is older — a genuinely new piece of
//     data is never rejected for being "stale."
//   - When BOTH devices have reported a value for the same field/element,
//     the batch with the later `device_captured_at` wins (the task's
//     literal wording: "scalar fields by device_captured_at latest-wins").
//     Since there is no per-element timestamp, the whole incoming batch's
//     `device_captured_at` stands in for "when this device's edits were
//     made" — this is the one place the approximation is coarser than
//     true per-field independence, and it is documented here rather than
//     silently assumed.
//
// Kept pure and separate from route.ts so the decision logic is
// unit-testable without Postgres (test/unit/capture/merge.test.ts).

export interface ScalarSnapshot {
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  waterDepthInteriorIn: number | null;
  waterDepthSource: string | null;
  notes: string | null;
  deviceCapturedAt: string | null;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ScalarMergeResult {
  merged: ScalarSnapshot;
  changes: FieldChange[];
  incomingIsNewer: boolean;
}

const SCALAR_FIELDS = [
  "gpsLat",
  "gpsLng",
  "gpsAccuracyM",
  "waterDepthInteriorIn",
  "waterDepthSource",
  "notes",
] as const;

function parseTs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * `existing === null` means this is the first sync ever for this
 * client_id — no merge decision to make, the incoming payload becomes the
 * row as-is (matches the pre-existing single-device-retry behavior, OT-5).
 */
export function mergeScalarFields(existing: ScalarSnapshot | null, incoming: ScalarSnapshot): ScalarMergeResult {
  if (existing === null) {
    return { merged: incoming, changes: [], incomingIsNewer: true };
  }

  const existingTs = parseTs(existing.deviceCapturedAt);
  const incomingTs = parseTs(incoming.deviceCapturedAt);
  const incomingIsNewer = incomingTs !== null && (existingTs === null || incomingTs >= existingTs);

  const merged = { ...existing };
  const changes: FieldChange[] = [];

  for (const field of SCALAR_FIELDS) {
    const incomingVal = incoming[field];
    const existingVal = existing[field];
    let finalVal: ScalarSnapshot[typeof field];
    if (incomingVal === null) {
      finalVal = existingVal; // untouched by the incoming device — never clobber
    } else if (existingVal === null) {
      finalVal = incomingVal; // filling a real gap, regardless of ordering
    } else {
      finalVal = incomingIsNewer ? incomingVal : existingVal;
    }
    if (finalVal !== existingVal) {
      changes.push({ field, before: existingVal, after: finalVal });
    }
    (merged as Record<string, unknown>)[field] = finalVal;
  }

  // device_captured_at itself only ever moves forward — it represents "the
  // latest device visit reflected in this record," used as the reference
  // point for the next sync's merge decision.
  merged.deviceCapturedAt =
    existingTs === null || (incomingTs !== null && incomingTs > existingTs) ? incoming.deviceCapturedAt : existing.deviceCapturedAt;

  return { merged, changes, incomingIsNewer };
}

export interface IncomingElement {
  elementCode: string;
  damagePct: number;
}

export interface ElementChange {
  elementCode: string;
  before: number;
  after: number;
}

export interface ElementMergeResult {
  toWrite: IncomingElement[];
  changes: ElementChange[];
}

/**
 * `existingDamage` is element_code -> damage_pct for whatever is already on
 * file. An element absent from `existingDamage` is always written (a real
 * gap, filled by whichever device reports it first). An element present in
 * both is only overwritten when `incomingIsNewer` — otherwise this device's
 * copy is stale for that element and is silently skipped (kept as-is),
 * never regressing a newer edit made by the other device.
 */
export function resolveElementMerge(
  existingDamage: Readonly<Record<string, number>>,
  incoming: readonly IncomingElement[],
  incomingIsNewer: boolean,
): ElementMergeResult {
  const toWrite: IncomingElement[] = [];
  const changes: ElementChange[] = [];

  for (const el of incoming) {
    const existingVal = existingDamage[el.elementCode];
    if (existingVal === undefined) {
      toWrite.push(el);
      continue;
    }
    if (existingVal === el.damagePct) {
      toWrite.push(el); // identical value — harmless no-op write
      continue;
    }
    if (incomingIsNewer) {
      toWrite.push(el);
      changes.push({ elementCode: el.elementCode, before: existingVal, after: el.damagePct });
    }
    // else: incoming is stale for this element — skip, keep what's on file.
  }

  return { toWrite, changes };
}
