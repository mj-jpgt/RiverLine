// Server-side photo upload hardening for app/api/capture/sync/route.ts.
//
// Per the OWASP File Upload Cheat Sheet
// (https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html,
// retrieved 2026-08-17): "Don't rely on the Content-Type header ... it can
// be spoofed" — validate file signatures (magic bytes) instead, and cap
// size. The sync route already re-verifies a client-declared sha256
// against the actual received bytes (pre-existing, T-C3); this module adds
// the two checks that didn't exist before this task: real signature
// sniffing (a declared `contentType: "image/jpeg"` in the request body is a
// claim, these bytes are proof) and an explicit per-photo size ceiling.

/**
 * 8MB per photo. Rationale (see docs/security-review.md "Upload
 * hardening"): build-spec §11.8 already commits the capture module to
 * client-side compression "to ~1600px longest edge before upload" for a
 * JPEG, which lands in the low hundreds of KB to low single-digit MB even
 * for a busy, high-detail interior shot. 8MB is roughly an order of
 * magnitude of headroom above that — generous enough to never reject a real
 * field photo, tight enough that a client sending raw/uncompressed
 * multi-megapixel captures (a bug, not malice) or a deliberately oversized
 * payload doesn't turn one sync call into an unbounded memory/disk write.
 *
 * Shared by two independent callers with two independent size budgets
 * (src/modules/a4-estimates/actions.ts's scanned-page uploads, and — until
 * F2 — app/api/capture/sync/route.ts's inline base64 photo bytes): this
 * constant is deliberately left as-is here. F2 (docs/journal/
 * 2026-08-19-f2-sync.md) needed a tighter, transport-specific ceiling for
 * its new raw-binary per-photo upload endpoint (Vercel's ~4.5MB serverless
 * body limit, discovered live) — that lives as its own local constant next
 * to that route instead of changing this shared value out from under
 * a4-estimates' unrelated, still-8MB-appropriate use case.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * 48MB overall request-body ceiling shared by two independent JSON-body
 * endpoints (src/modules/a4-estimates' estimate upload, and — until F2 —
 * app/api/capture/sync's inline photo bytes) as a coarse first-line guard
 * (checked via Content-Length before the body is even parsed), not the
 * primary control. F2 (docs/journal/2026-08-19-f2-sync.md): the capture
 * sync/finalize endpoint no longer carries photo bytes at all (they upload
 * individually beforehand — see MAX_PHOTO_BYTES's comment above and
 * app/api/photos/upload/[id]/route.ts), so it now enforces its own much
 * tighter, locally-defined body ceiling instead of this shared one — left
 * unchanged here so a4-estimates' still-legitimate use of this value isn't
 * silently affected by a capture-module-specific tightening.
 */
export const MAX_SYNC_BODY_BYTES = 48 * 1024 * 1024;

export type SniffedImageType = "jpeg" | "png" | "webp";

/**
 * Magic-byte sniff for the three formats the build spec's cost-estimating
 * OCR/photo work ever names. Returns null if the bytes don't match a known
 * signature — callers should treat null as "reject," never "assume jpeg."
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  ) {
    return "webp";
  }
  return null;
}
