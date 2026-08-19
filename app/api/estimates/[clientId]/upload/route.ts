import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { checkRateLimit, rateLimitResponse } from "@/shared/security/rate-limit";
import { MAX_SYNC_BODY_BYTES } from "@/shared/security/upload-validation";
import { createEstimateVersion } from "@/modules/a4-estimates";

// A4 estimate upload (spec §8): a NEW estimate version for the assessment
// identified by clientId (same URL scheme every other module uses —
// app/capture, app/calculation, app/determination, app/letters). OCR (if
// it ran) has already happened client-side (docs/adr/0007) — this route
// only re-verifies the claimed page hashes against the real bytes and
// persists. Role set matches app/api/capture/sync/route.ts (assessor or
// official may upload; viewer may not).
//
// Hardening (per docs/security-review.md's W3 audit, 2026-08-17 — flagged
// this route specifically as lacking the size cap / magic-byte checks
// app/api/capture/sync/route.ts already has): a coarse Content-Length
// check up front, then per-page size + real-signature validation inside
// createEstimateVersion (src/modules/a4-estimates/actions.ts) using the
// SAME shared src/shared/security/upload-validation.ts the sync route
// uses, not a duplicate. Also rate-limited per acting user, same shape as
// sync's own limiter — an estimate upload is a single human-initiated
// action (not an offline retry queue), so a tighter window than sync's
// 30/min is honest: 10 uploads/minute comfortably covers "attach a few
// versions/pages in one sitting" while bounding a scripted abuse loop.
const UPLOAD_LIMIT = 10;
const UPLOAD_WINDOW_MS = 60 * 1000;

const bboxSchema = z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() });

const ocrLineSchema = z.object({
  text: z.string(),
  bbox: bboxSchema,
  confidence: z.number(),
});

const candidateLineItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  amountRawText: z.string(),
  amountDollars: z.number().nullable(),
  confidence: z.number(),
  bbox: bboxSchema,
  sourceLineIndex: z.number(),
  pageIndex: z.number(),
});

const candidateTotalSchema = candidateLineItemSchema.omit({ description: true }).extend({
  label: z.string(),
});

const extractedPageSchema = z.object({
  pageIndex: z.number(),
  imageWidthPx: z.number(),
  imageHeightPx: z.number(),
  fullText: z.string(),
  lines: z.array(ocrLineSchema),
});

const extractedJsonSchema = z.object({
  engine: z.literal("tesseract.js"),
  engineVersion: z.string(),
  extractedAtIso: z.string(),
  pages: z.array(extractedPageSchema),
  lineItems: z.array(candidateLineItemSchema),
  candidateTotals: z.array(candidateTotalSchema),
});

const pageSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  dataBase64: z.string().min(1),
  contentType: z.literal("image/jpeg"),
  originalFilename: z.string().nullable(),
  widthPx: z.number(),
  heightPx: z.number(),
});

const bodySchema = z.object({
  pages: z.array(pageSchema).min(1),
  extracted: extractedJsonSchema.nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const uploadCheck = checkRateLimit(`estimates-upload:user:${userId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
    if (!uploadCheck.allowed) {
      return rateLimitResponse(uploadCheck, "Too many estimate uploads. Try again shortly.");
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_SYNC_BODY_BYTES) {
      return NextResponse.json({ error: "Upload payload is too large." }, { status: 413 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed upload payload.", issues: parsed.error.issues }, { status: 400 });
    }

    const result = await createEstimateVersion(jurisdictionId, userId, clientId, parsed.data);

    if (result.status === "not_found") {
      return NextResponse.json({ error: "No assessment found for that id." }, { status: 404 });
    }
    if (result.status === "hash_mismatch") {
      return NextResponse.json(
        { error: `Page ${result.pageIndex + 1} sha256 mismatch. Refusing to store unverified bytes.` },
        { status: 400 },
      );
    }
    if (result.status === "too_large") {
      return NextResponse.json({ error: `Page ${result.pageIndex + 1} exceeds the size limit.` }, { status: 413 });
    }
    if (result.status === "invalid_image_type") {
      return NextResponse.json(
        { error: `Page ${result.pageIndex + 1} is not a valid image. Refusing to store unverified bytes.` },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, estimateId: result.estimateId, version: result.version });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[estimates] upload failed:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
