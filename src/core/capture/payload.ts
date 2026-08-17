// The wire format POSTed to /api/capture/sync. Shared between the client
// (this file, pure — no fetch/idb) and documents what the server route
// expects. Photos travel as base64 JSON, not multipart — documented choice
// (see docs/journal/2026-08-17-c3-capture.md): this project has no chunked/
// resumable upload requirement in MVP scope, downscaled photos are small
// (~100-400KB after src/core/capture/photo.ts's 1600px-longest-edge
// resize), and a single JSON body keeps the idempotent-upsert transaction in
// app/api/capture/sync/route.ts simple (one parsed body, one transaction) at
// the cost of ~33% base64 overhead on the wire — an acceptable MVP tradeoff
// given sync only ever runs opportunistically in the foreground on a
// connection, never during capture itself. A production swap to multipart
// or direct-to-object-storage presigned upload is a compatible future change
// that would not alter this payload's semantics.
import type { CaptureDraft } from "./types";
import { getPhotosForDraft } from "./db";

export interface SyncPhotoPayload {
  id: string;
  elementCode: string | null;
  sha256: string;
  capturedAt: string;
  gpsLat: number | null;
  gpsLng: number | null;
  dataBase64: string;
  contentType: "image/jpeg";
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

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buf) => {
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  });
}

/** Builds the sync payload for a completed draft, reading photo bytes from
 * IndexedDB. Only elements with a damage % are included (a draft can only
 * reach "queued" via completeDraft() once every element and the exterior
 * photo are present, per draft.ts canAdvanceFromStep's review-screen check,
 * but this is defensive rather than assuming that invariant here too). */
export async function buildSyncPayload(draft: CaptureDraft): Promise<SyncPayload> {
  const photos = await getPhotosForDraft(draft.clientId);
  const photoPayloads: SyncPhotoPayload[] = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      elementCode: p.elementCode,
      sha256: p.sha256,
      capturedAt: p.capturedAt,
      gpsLat: p.gps?.lat ?? null,
      gpsLng: p.gps?.lng ?? null,
      dataBase64: await blobToBase64(p.blob),
      contentType: "image/jpeg" as const,
    })),
  );

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
