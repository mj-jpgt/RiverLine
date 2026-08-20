import type { Occupancy } from "./elements";

export type WaterDepthSource =
  | "observed_line"
  | "measured"
  | "owner_reported"
  | "modeled"
  | "unknown";

export const WATER_DEPTH_SOURCES: readonly { value: WaterDepthSource; label: string }[] = [
  { value: "observed_line", label: "Observed water line" },
  { value: "measured", label: "Measured" },
  { value: "owner_reported", label: "Owner reported" },
  { value: "modeled", label: "Modeled" },
  { value: "unknown", label: "Unknown" },
];

export const DAMAGE_PCT_PRESETS = [0, 10, 25, 50, 75, 100] as const;

export type FoundationType = "slab" | "crawlspace" | "basement" | "pier" | "other";

export const FOUNDATION_TYPES: readonly { value: FoundationType; label: string }[] = [
  { value: "slab", label: "Slab" },
  { value: "crawlspace", label: "Crawlspace" },
  { value: "basement", label: "Basement" },
  { value: "pier", label: "Pier" },
  { value: "other", label: "Other" },
];

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

/** Per-photo upload state (F2: photos now upload individually to
 * app/api/photos/upload/[id] BEFORE the draft's own sync payload is sent —
 * see src/core/capture/photo-upload.ts. "uploaded" is durable/authoritative
 * (the bytes are confirmed written to storage server-side); everything else
 * is a client-local retry state, mirroring CaptureDraft's own
 * syncStatus/syncAttempts/lastSyncError/lastAttemptAt shape so the same
 * backoff policy (src/core/capture/backoff.ts) applies uniformly. Persisted
 * (not just in-memory) specifically so a kill-mid-upload resume knows which
 * photos are already confirmed on the server and skips re-uploading them. */
export type PhotoUploadStatus = "pending" | "uploaded" | "error";

/** One captured photo. Bytes live in the "photos" IndexedDB object store
 * (src/core/capture/db.ts); this is the metadata record referenced from a
 * draft's element/exterior photo id lists. */
export interface PhotoRecord {
  id: string; // client-generated uuid; becomes photos.id server-side (idempotency key)
  clientId: string; // owning draft's client_id
  elementCode: string | null; // null = the required exterior shot
  sha256: string;
  capturedAt: string; // ISO
  gps: GpsFix | null;
  blob: Blob;
  width: number;
  height: number;
  uploadStatus: PhotoUploadStatus;
  uploadAttempts: number;
  lastUploadError: string | null;
  lastUploadAttemptAt: string | null;
}

/** Default upload-state fields for a freshly captured photo — used by every
 * call site that constructs a PhotoRecord (app/capture/[id]/CaptureFlow.tsx)
 * so the shape stays centralized in one place rather than repeated inline. */
export function newPhotoUploadState(): Pick<
  PhotoRecord,
  "uploadStatus" | "uploadAttempts" | "lastUploadError" | "lastUploadAttemptAt"
> {
  return { uploadStatus: "pending", uploadAttempts: 0, lastUploadError: null, lastUploadAttemptAt: null };
}

export interface ElementCapture {
  code: string;
  damagePct: number | null;
  photoIds: string[];
}

export type SyncStatus = "draft" | "queued" | "syncing" | "synced" | "error";

export const CAPTURE_STEPS = [
  "attributes",
  "elements", // one virtual step per element, indexed separately (see stepIndex)
  "exterior_photo",
  "water_depth",
  "notes",
  "review",
] as const;

/** The full offline draft of one assessment in progress. Keyed by clientId
 * (== assessments.client_id, the sync idempotency key) — generated once when
 * the assessor starts an assessment for a structure, per task spec: "draft
 * keyed by structure + client_id uuid generated at start." */
export interface CaptureDraft {
  clientId: string;
  structureId: string;
  jurisdictionId: string;

  occupancyType: Occupancy | null;
  sqFt: number | null;
  stories: number | null;
  foundationType: FoundationType | null;

  gps: GpsFix | null;
  gpsRequestedAt: string | null;

  elements: ElementCapture[]; // ordered per elementsForOccupancy(occupancyType)
  exteriorPhotoIds: string[];

  waterDepthInteriorIn: number | null;
  waterDepthSource: WaterDepthSource | null;
  notes: string;

  /** Index into the flat screen sequence this draft resumes at. Screen 0 is
   * always "attributes"; screens 1..elements.length are element screens;
   * then exterior photo, water depth, notes, review. */
  stepIndex: number;

  startedAt: string;
  completedAt: string | null;
  updatedAt: string;

  syncStatus: SyncStatus;
  syncAttempts: number;
  lastSyncError: string | null;
  /** ISO timestamp of the last sync attempt (success or failure) — used to
   * enforce backoff between automatic retries (src/core/capture/sync.ts)
   * without a scheduled setTimeout. A manual "Sync now" tap always bypasses
   * this and attempts immediately. */
  lastAttemptAt: string | null;
}

export function isDraftComplete(draft: CaptureDraft): boolean {
  return (
    draft.occupancyType !== null &&
    draft.elements.length > 0 &&
    draft.elements.every((e) => e.damagePct !== null) &&
    draft.exteriorPhotoIds.length > 0 &&
    draft.completedAt !== null
  );
}
