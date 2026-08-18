"use client";

// Client-side estimate-document image processing. Reuses the SAME
// downscale + sha256 pipeline src/core/capture/photo.ts already established
// for damage photos (imported through src/core/capture's index.ts per
// eslint-plugin-boundaries — "modules/<x> may reach core only through its
// index.ts", docs/adr/0003-module-boundary-enforcement.md) rather than
// re-implementing canvas/hash logic a second time in this module.
import { processPhoto, sha256Hex } from "@/core/capture";
import type { EstimatePageUpload } from "./types";

/** Downscales + JPEG-encodes + hashes one selected file, and base64-encodes
 * the result for the JSON upload payload
 * (app/api/capture/sync/route.ts already established base64-in-JSON over
 * multipart for this codebase — see that file's header for the documented
 * tradeoff — this module follows the same convention). Returns both the
 * upload-ready payload AND the decoded Blob (still needed in-memory for
 * OCR, which runs on the same processed image so the extracted bboxes line
 * up with the exact bytes that get stored). */
export async function processEstimatePage(
  file: File,
): Promise<{ upload: EstimatePageUpload; blob: Blob }> {
  const processed = await processPhoto(file);
  const buf = await processed.blob.arrayBuffer();
  const dataBase64 = arrayBufferToBase64(buf);
  return {
    upload: {
      sha256: processed.sha256,
      dataBase64,
      contentType: "image/jpeg",
      originalFilename: file.name || null,
      widthPx: processed.width,
      heightPx: processed.height,
    },
    blob: processed.blob,
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Re-exported so callers that only need a raw hash (not the full
// downscale) don't have to reach into src/core/capture directly — keeps
// every cross-module import funneled through this one file.
export { sha256Hex };
