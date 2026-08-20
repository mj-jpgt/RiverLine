// The wire format POSTed to /api/capture/sync. Shared between the client
// (this file, pure — no fetch/idb) and documents what the server route
// expects.
//
// F2 (2026-08-19): this used to also carry every photo's base64 bytes
// inline — the "production swap to multipart or direct-to-object-storage
// presigned upload" this file's header previously flagged as a compatible
// future change. That swap happened here: Vercel enforces a hard ~4.5MB
// body ceiling per serverless invocation (platform-level, below this app's
// own MAX_SYNC_BODY_BYTES check), reproduced live returning
// `413 FUNCTION_PAYLOAD_TOO_LARGE` for a realistic multi-photo assessment —
// see docs/journal/2026-08-19-f2-sync.md. Photo bytes now upload
// individually first, via src/core/capture/photo-upload.ts to
// app/api/photos/upload/[id] (raw binary body, content-addressed storage
// key), gated by src/core/capture/sync.ts before this payload is ever
// built. This payload is metadata only — a few KB regardless of photo
// count — referencing each photo by id/sha256 so app/api/capture/sync/
// route.ts can look up the storage key it already wrote and confirm it
// exists before creating the `photos` row.
import type { CaptureDraft } from "./types";
import { getPhotosForDraft } from "./db";

export interface SyncPhotoPayload {
  id: string;
  elementCode: string | null;
  sha256: string;
  capturedAt: string;
  gpsLat: number | null;
  gpsLng: number | null;
}

export interface SyncPayload {
  clientId: string;
  structureId: string;
  structureUpdates: {
    occupancyType: string | null;
    sqFt: number | null;
    stories: number | null;
    foundationType: string | null;
  };
  assessment: {
    gpsLat: number | null;
    gpsLng: number | null;
    gpsAccuracyM: number | null;
    deviceCapturedAt: string | null;
    waterDepthInteriorIn: number | null;
    waterDepthSource: string | null;
    notes: string | null;
    completedAt: string | null;
  };
  elements: { elementCode: string; damagePct: number }[];
  photos: SyncPhotoPayload[];
}

/** Builds the sync payload for a completed draft. Only elements with a
 * damage % are included (a draft can only reach "queued" via
 * completeDraft() once every element and the exterior photo are present,
 * per draft.ts canAdvanceFromStep's review-screen check, but this is
 * defensive rather than assuming that invariant here too).
 *
 * Callers (src/core/capture/sync.ts's syncOne) are responsible for
 * confirming every photo is already uploaded (PhotoRecord.uploadStatus ===
 * "uploaded") before calling this — this function does not filter or
 * re-check that itself, it just reports every photo attached to the draft,
 * same as before F2. */
export async function buildSyncPayload(draft: CaptureDraft): Promise<SyncPayload> {
  const photos = await getPhotosForDraft(draft.clientId);
  const photoPayloads: SyncPhotoPayload[] = photos.map((p) => ({
    id: p.id,
    elementCode: p.elementCode,
    sha256: p.sha256,
    capturedAt: p.capturedAt,
    gpsLat: p.gps?.lat ?? null,
    gpsLng: p.gps?.lng ?? null,
  }));

  return {
    clientId: draft.clientId,
    structureId: draft.structureId,
    structureUpdates: {
      occupancyType: draft.occupancyType,
      sqFt: draft.sqFt,
      stories: draft.stories,
      foundationType: draft.foundationType,
    },
    assessment: {
      gpsLat: draft.gps?.lat ?? null,
      gpsLng: draft.gps?.lng ?? null,
      gpsAccuracyM: draft.gps?.accuracyM ?? null,
      deviceCapturedAt: draft.startedAt,
      waterDepthInteriorIn: draft.waterDepthInteriorIn,
      waterDepthSource: draft.waterDepthSource,
      notes: draft.notes.trim().length > 0 ? draft.notes.trim() : null,
      completedAt: draft.completedAt,
    },
    elements: draft.elements
      .filter((e): e is { code: string; damagePct: number; photoIds: string[] } => e.damagePct !== null)
      .map((e) => ({ elementCode: e.code, damagePct: e.damagePct })),
    photos: photoPayloads,
  };
}
