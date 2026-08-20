import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import path from "node:path";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getStorageDriver } from "@/shared/storage";
import { checkRateLimit, rateLimitResponse } from "@/shared/security/rate-limit";
import { sniffImageType } from "@/shared/security/upload-validation";

// F2 (2026-08-19, docs/journal/2026-08-19-f2-sync.md): one photo's bytes,
// uploaded on their own, BEFORE the draft's metadata-only finalize payload
// goes to app/api/capture/sync. Root cause this exists to fix: that route
// used to also carry every queued photo's base64 bytes inline in one JSON
// body. Vercel enforces a hard ~4.5MB request-body ceiling per serverless
// invocation at the platform level — reproduced live returning
// `413 FUNCTION_PAYLOAD_TOO_LARGE` (Vercel's own platform error, before this
// app's code ever runs) for a realistic multi-photo assessment. Splitting
// photo transport into its own per-photo request, each safely under that
// ceiling, is the fix.
//
// Raw binary body, not JSON+base64 (unlike the old inline design and unlike
// src/modules/a4-estimates' JSON upload) — deliberately, to buy back the
// ~33% base64 tax against Vercel's fixed ceiling, since a single photo
// upload has no other fields to carry alongside the bytes (metadata travels
// in headers instead). This is the "production swap to multipart or
// direct-to-object-storage presigned upload" src/core/capture/payload.ts's
// original header comment already flagged as a compatible future change.
//
// Content-addressed storage key (`<jurisdictionId>/<sha256>.jpg`, same
// scheme app/api/capture/sync/route.ts always used — see
// docs/adr/0008-object-storage.md), computed server-side from the actually
// received, hash-verified bytes — never trusts the client's claimed sha256
// for the key itself, only compares against it to surface a clear client-
// side-bug diagnostic rather than silently storing under a different key
// than the client will reference in its later finalize payload. Idempotent
// by construction: re-POSTing the same photo id with the same bytes (a
// retried request after a dropped connection, or a resumed queue after the
// app was killed mid-upload) is a safe no-op write either storage driver
// honors.
//
// Auth + tenant + rate-limit pattern copied from app/api/capture/sync/route.ts;
// magic-byte sniffing reused from src/shared/security/upload-validation.ts
// (the same helper app/api/capture/sync/route.ts and
// src/modules/a4-estimates/actions.ts already use) rather than reinvented.

const PHOTO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

// 4MB raw. Vercel's own serverless body ceiling is ~4.5MB regardless of
// encoding (confirmed live — see this file's header) — 4MB leaves roughly
// 700KB of headroom for headers and any platform overhead. Deliberately a
// local constant, not src/shared/security/upload-validation.ts's
// MAX_PHOTO_BYTES (8MB): that shared constant is also used by
// src/modules/a4-estimates' unrelated JSON+base64 upload flow with its own
// size budget, and lowering it there was not this task's call to make (see
// that file's own updated comment). A real field photo never approaches
// this ceiling: build-spec §11.8's client-side compression "to ~1600px
// longest edge" lands a busy, high-detail interior shot in the low hundreds
// of KB to low-single-digit MB — verified empirically during this task's
// live reproduction, where a worst-case, maximally-incompressible synthetic
// 1600x1200 photo came in at ~1.27MB, well under a third of this ceiling.
const MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;

// Generous relative to sync's 30/min: a device catching up after being
// offline can legitimately burst through a dozen-plus photos across several
// queued assessments in quick succession, one request per photo. 90/min
// bounds a runaway retry loop (a bug, not a real device) without capping a
// real catch-up — see docs/security-review.md "Rate limiting" for the
// sibling routes' own reasoning, same style applied here.
const UPLOAD_LIMIT = 90;
const UPLOAD_WINDOW_MS = 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    if (!PHOTO_ID_RE.test(id)) {
      return NextResponse.json({ error: "Malformed photo id." }, { status: 400 });
    }

    const uploadCheck = checkRateLimit(`photo-upload:user:${userId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
    if (!uploadCheck.allowed) {
      return rateLimitResponse(uploadCheck, "Too many photo uploads. It will remain queued and retry.");
    }

    const claimedSha256 = request.headers.get("x-photo-sha256");
    if (!claimedSha256 || !SHA256_RE.test(claimedSha256)) {
      return NextResponse.json({ error: "Missing or malformed X-Photo-Sha256 header." }, { status: 400 });
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_PHOTO_UPLOAD_BYTES) {
      return NextResponse.json({ error: `Photo exceeds the ${MAX_PHOTO_UPLOAD_BYTES} byte limit.` }, { status: 413 });
    }

    const bytes = Buffer.from(await request.arrayBuffer());

    // Content-Length can be absent or wrong — re-check the bytes actually
    // received before doing anything else with them.
    if (bytes.length === 0) {
      return NextResponse.json({ error: "Empty photo upload." }, { status: 400 });
    }
    if (bytes.length > MAX_PHOTO_UPLOAD_BYTES) {
      return NextResponse.json({ error: `Photo exceeds the ${MAX_PHOTO_UPLOAD_BYTES} byte limit.` }, { status: 413 });
    }

    // Signature, not the client's Content-Type claim (OWASP File Upload
    // Cheat Sheet — same reasoning app/api/capture/sync/route.ts already
    // documents at length).
    if (sniffImageType(bytes) !== "jpeg") {
      return NextResponse.json(
        { error: "Photo is not a valid JPEG — refusing to store unverified bytes." },
        { status: 400 },
      );
    }

    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== claimedSha256.toLowerCase()) {
      return NextResponse.json(
        { error: "Photo sha256 mismatch — refusing to store unverified bytes." },
        { status: 400 },
      );
    }

    const storageKey = path.posix.join(jurisdictionId, `${actualSha256}.jpg`);
    await getStorageDriver().put(storageKey, bytes, "image/jpeg");

    return NextResponse.json({ ok: true, storageKey });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[capture] photo upload failed:", err);
    return NextResponse.json({ error: "Photo upload failed. It will remain queued and retry." }, { status: 500 });
  }
}
