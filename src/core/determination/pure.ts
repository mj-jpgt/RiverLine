// Pure, zero-I/O helpers for the determination module — unit-testable
// without Postgres. Kept separate from queries.ts (which does all the DB
// work) the same way src/core/capture/draft.ts is split from db.ts.

import type { ElementDefinition } from "@/core/capture";
import type { DeterminationStatus, QueueStatusFilter, ReviewPhoto, ReviewQueueRow } from "./types";

/** Sort order for the review queue per task instructions: "sorted BORDERLINE
 * first, then SD, then NOT_SD, then drafts/no-calculation." Within a bucket,
 * oldest-completed-first (the assessment that has been waiting longest gets
 * seen first) — not specified explicitly, but the only defensible default
 * for a review queue. */
const BUCKET_ORDER: Record<string, number> = {
  BORDERLINE: 0,
  SD: 1,
  NOT_SD: 2,
};

export function queueBucket(row: Pick<ReviewQueueRow, "thresholdResult">): number {
  if (row.thresholdResult === null) return 3;
  return BUCKET_ORDER[row.thresholdResult] ?? 3;
}

export function compareQueueRows(a: ReviewQueueRow, b: ReviewQueueRow): number {
  const bucketDiff = queueBucket(a) - queueBucket(b);
  if (bucketDiff !== 0) return bucketDiff;
  return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
}

export function sortQueueRows(rows: readonly ReviewQueueRow[]): ReviewQueueRow[] {
  return [...rows].sort(compareQueueRows);
}

/** Applies the queue's status filter. "DRAFT_NO_CALC" means "no calculation
 * yet" (never a determination-status "draft" — see types.ts doc comment);
 * the four filter values are exactly the four canonical status badges from
 * docs/design/direction.md ("Color and meaning": NOT_SD/BORDERLINE/SD/Draft). */
export function filterQueueRows(
  rows: readonly ReviewQueueRow[],
  filter: QueueStatusFilter,
): ReviewQueueRow[] {
  if (filter === "ALL") return [...rows];
  if (filter === "DRAFT_NO_CALC") return rows.filter((r) => r.thresholdResult === null);
  return rows.filter((r) => r.thresholdResult === filter);
}

/**
 * appeal_deadline_date = adopted date + jurisdiction's configured
 * appeal-window days. NO DEFAULT — a jurisdiction with no configured window
 * (jurisdictions.letterhead_config.appeal_window_days absent/invalid) gets
 * `null` here, never an invented number of days (task instructions,
 * docs/BLOCKERS.md B2). Date-only arithmetic (UTC, no time-of-day drift)
 * because `determinations.appeal_deadline_date` is a `date` column.
 */
export function computeAppealDeadlineDate(adoptedAtIso: string, appealWindowDays: number | null): string | null {
  if (appealWindowDays === null || !Number.isFinite(appealWindowDays) || appealWindowDays <= 0) {
    return null;
  }
  const adopted = new Date(adoptedAtIso);
  const deadline = new Date(
    Date.UTC(adopted.getUTCFullYear(), adopted.getUTCMonth(), adopted.getUTCDate()),
  );
  deadline.setUTCDate(deadline.getUTCDate() + Math.floor(appealWindowDays));
  return deadline.toISOString().slice(0, 10);
}

/** Reads jurisdictions.letterhead_config.appeal_window_days safely — the
 * only free config slot for this per task instructions. Never guesses a
 * number when the field is missing or malformed; returns null (the honest
 * "not configured" state) rather than a fabricated default. */
export function readAppealWindowDays(letterheadConfig: unknown): number | null {
  if (typeof letterheadConfig !== "object" || letterheadConfig === null) return null;
  const value = (letterheadConfig as Record<string, unknown>).appeal_window_days;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Whether an "Adopt determination" action is allowed to proceed at all
 * (never mind the appeal-window gap, which is orthogonal — adoption is not
 * blocked by a missing appeal-window config, only appeal_deadline_date is
 * left null; AGENTS.md rule 12 is about auto-adoption, not about refusing a
 * legitimate, explicit, human-confirmed adopt action). */
export function canAdopt(currentStatus: DeterminationStatus | null): boolean {
  return currentStatus === null || currentStatus === "draft";
}

export function canSupersede(currentStatus: DeterminationStatus | null): boolean {
  return currentStatus === "adopted" || currentStatus === "contested";
}

/** One heading + its photos in the T-C7 grouped review gallery. `code` is the
 * SDE element code, the literal `"exterior"`, or `"other"` for the
 * legacy/unassociated bucket — used as a stable React key, never rendered
 * directly (heading is the display text). */
export interface PhotoGroup {
  code: string;
  heading: string;
  photos: ReviewPhoto[];
}

/**
 * Groups a flat photo list (ReviewDetail.photos) into per-element sections
 * for the review screen, per specs/core/tasks.md T-C7: element sections (in
 * the occupancy's element order) each headed by the element's verbatim SDE
 * display name, then "Exterior" for element_code = 'exterior', then "Other
 * photos" for anything else — null (legacy rows synced before migration
 * 0004) or a code that doesn't match this occupancy's current element list
 * (defensive: never silently drops a photo). A group with zero photos is
 * omitted entirely rather than rendered as an empty heading — this differs
 * from the per-element override table's "flag, don't hide" rule, which is
 * about a specific element's *missing* photo, not about not spamming every
 * one of 12/7 headings when only two elements actually have photos.
 */
export function groupPhotosByElement(
  photos: readonly ReviewPhoto[],
  elementDefs: readonly ElementDefinition[],
): PhotoGroup[] {
  const groups: PhotoGroup[] = [];

  for (const def of elementDefs) {
    const matched = photos.filter((p) => p.elementCode === def.code);
    if (matched.length > 0) groups.push({ code: def.code, heading: def.name, photos: matched });
  }

  const exterior = photos.filter((p) => p.elementCode === "exterior");
  if (exterior.length > 0) groups.push({ code: "exterior", heading: "Exterior", photos: exterior });

  const knownCodes = new Set<string>([...elementDefs.map((d) => d.code), "exterior"]);
  const other = photos.filter((p) => p.elementCode === null || !knownCodes.has(p.elementCode));
  if (other.length > 0) groups.push({ code: "other", heading: "Other photos", photos: other });

  return groups;
}
