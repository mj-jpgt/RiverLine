// Client-side photo processing: downscale to ~1600px longest edge before
// storing (build spec §11.8 — keeps the offline queue small and sync fast on
// a bad connection), then SHA-256 the final bytes (schema/core.sql
// photos.sha256 — computed client-side per task spec, verified again
// server-side in app/api/capture/sync/route.ts before it's trusted).
"use client";

export const MAX_LONGEST_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.82;

export interface ProcessedPhoto {
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
}

/** SHA-256 of arbitrary bytes via the Web Crypto API (available in every
 * browser this product targets, and in Node's test runner via
 * globalThis.crypto — no extra dependency). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Downscale an image File to at most MAX_LONGEST_EDGE_PX on its longest
 * edge (no upscaling of smaller images), re-encode as JPEG, and hash the
 * result. Runs entirely in-browser via <canvas> — no upload required to
 * process a photo, which matters offline. */
export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_LONGEST_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context to process the photo.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) {
    throw new Error("Could not encode the photo.");
  }

  const buf = await blob.arrayBuffer();
  const sha256 = await sha256Hex(buf);

  return { blob, width, height, sha256 };
}
