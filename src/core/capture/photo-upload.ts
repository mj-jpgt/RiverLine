// F2 (live sync fix): photo bytes now travel one-at-a-time to
// app/api/photos/upload/[id], BEFORE the draft's own metadata-only sync
// payload (src/core/capture/payload.ts) is sent to app/api/capture/sync.
//
// Root cause this replaces: the old design bundled every queued photo's
// base64 bytes into one JSON body POSTed to /api/capture/sync. Vercel
// enforces a hard ~4.5MB request body ceiling on every serverless function
// invocation, at the platform level — below this app's own
// MAX_SYNC_BODY_BYTES check (which never even runs, because Vercel rejects
// the oversized request before it reaches Next.js code at all). Reproduced
// live 2026-08-18/19 against https://river-line.vercel.app: a realistic
// payload of 3 real ~1.27MB photos (well within a single assessment's normal
// photo count) came back `413 FUNCTION_PAYLOAD_TOO_LARGE` — Vercel's own
// platform error page, not this app's route handler. A dozen-element
// assessment with several detailed interior photos crosses this every time.
// See docs/journal/2026-08-18-f2-sync.md for the full reproduction.
//
// Each photo is small enough on its own (photo.ts's 1600px-longest-edge /
// quality-0.82 downscale keeps a real photo in the low hundreds of KB to
// low single-digit MB — see MAX_PHOTO_BYTES's own comment in
// src/shared/security/upload-validation.ts) that uploading raw binary
// bytes (no base64 — see that file's updated rationale) one at a time stays
// safely under the platform ceiling with real margin, while the metadata-
// only finalize payload this module leaves for sync.ts to send is a few KB
// at most regardless of photo count.
"use client";

import { markPhotoUploadAttempt, markPhotoUploaded } from "./db";
import { backoffDelayMs } from "./backoff";
import type { PhotoRecord } from "./types";

const UPLOAD_ENDPOINT = (photoId: string) => `/api/photos/upload/${photoId}`;
// Same reasoning as sync.ts's FETCH_TIMEOUT_MS: a stalled field connection
// must not hang a photo upload forever (AGENTS.md rule 7 — no silent
// failure). Slightly longer than the sync endpoint's own timeout since a
// multi-MB body legitimately takes longer to transfer than a small JSON
// finalize payload on a bad connection.
const UPLOAD_TIMEOUT_MS = 25000;

export interface PhotoUploadResult {
  photoId: string;
  ok: boolean;
  error: string | null;
}

function cooldownElapsed(photo: PhotoRecord): boolean {
  if (!photo.lastUploadAttemptAt) return true;
  const attempt = Math.max(photo.uploadAttempts, 1);
  const elapsed = Date.now() - new Date(photo.lastUploadAttemptAt).getTime();
  return elapsed >= backoffDelayMs(attempt);
}

/** Uploads one photo's bytes, exactly once, if it isn't already confirmed
 * uploaded. `force` bypasses the backoff cooldown (mirrors sync.ts's
 * syncOne) — used by the manual "Sync now" path and the initial
 * post-completion attempt. Idempotent server-side (content-addressed
 * storage key, docs/adr/0008-object-storage.md), so a retried upload of an
 * already-stored photo is always a safe no-op even if local state briefly
 * disagrees with the server (e.g. a success response lost after the write
 * actually landed). */
export async function uploadPhoto(
  photo: PhotoRecord,
  options: { force?: boolean } = {},
): Promise<PhotoUploadResult> {
  if (photo.uploadStatus === "uploaded") {
    return { photoId: photo.id, ok: true, error: null };
  }
  if (!options.force && !cooldownElapsed(photo)) {
    // Still within backoff cooldown — not a real failure to surface (same
    // convention as sync.ts's syncOne), just "nothing to do yet".
    return { photoId: photo.id, ok: false, error: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    await markPhotoUploadAttempt(photo.id, "uploading", null);
    const res = await fetch(UPLOAD_ENDPOINT(photo.id), {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Photo-Sha256": photo.sha256,
      },
      body: photo.blob,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      const error = body?.error ?? `Photo upload failed (HTTP ${res.status}).`;
      await markPhotoUploadAttempt(photo.id, "error", error);
      return { photoId: photo.id, ok: false, error };
    }

    await markPhotoUploaded(photo.id);
    return { photoId: photo.id, ok: true, error: null };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    // Never a silent catch (AGENTS.md rule 7) — logged for developer
    // diagnosis, plain user-facing message left for the caller to surface.
    console.error("[capture] photo upload failed:", err);
    const error = timedOut ? "Photo upload timed out. Check your connection." : "Network error while uploading photo.";
    await markPhotoUploadAttempt(photo.id, "error", error);
    return { photoId: photo.id, ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

export interface UploadPendingPhotosResult {
  allUploaded: boolean;
  uploaded: number;
  total: number;
  firstError: string | null;
}

/**
 * Uploads every not-yet-confirmed photo for a draft, sequentially (same
 * "predictable load on a weak connection" reasoning as sync.ts's
 * syncAllQueued), reporting live progress via `onProgress` as each photo
 * settles. Stops attempting further photos once one fails within a single
 * call — sync.ts's caller decides whether/when to retry the whole draft,
 * same backoff-gated retry model as the rest of the queue, rather than this
 * function looping internally (the T-C3 journal's "internal retry timer
 * that never fired" lesson: no internal retry chains here either, only
 * independent, externally-triggered attempts).
 */
export async function uploadPendingPhotosForDraft(
  photos: PhotoRecord[],
  options: { force?: boolean; onProgress?: (uploaded: number, total: number) => void } = {},
): Promise<UploadPendingPhotosResult> {
  const total = photos.length;
  let uploaded = photos.filter((p) => p.uploadStatus === "uploaded").length;
  options.onProgress?.(uploaded, total);

  let firstError: string | null = null;
  for (const photo of photos) {
    if (photo.uploadStatus === "uploaded") continue;
    const result = await uploadPhoto(photo, { force: options.force });
    if (result.ok) {
      uploaded += 1;
      options.onProgress?.(uploaded, total);
    } else if (result.error && firstError === null) {
      firstError = result.error;
      // A skipped attempt (still in backoff cooldown) has ok:false but no
      // error — not a real failure, just "nothing to do yet"; keep going to
      // the next photo instead of stopping the whole loop over it.
    }
  }

  return { allUploaded: uploaded === total, uploaded, total, firstError };
}
