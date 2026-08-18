// Mutations for the A4 estimates module. Every write is jurisdiction-scoped
// through withTenant() (RLS-enforced), same pattern
// app/api/capture/sync/route.ts and app/determination/_lib/actions.ts
// already use.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { MAX_PHOTO_BYTES, sniffImageType } from "@/shared/security/upload-validation";
import { combinedDocumentHashInput } from "./parser";
import type { ConfirmEstimateInput, ConfirmEstimateResult, CreateEstimateInput, CreateEstimateResult } from "./types";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

async function writeEstimatePageFile(jurisdictionId: string, sha256: string, base64: string): Promise<string> {
  const dir = path.join(UPLOADS_ROOT, jurisdictionId, "estimates");
  await mkdir(dir, { recursive: true });
  const storageKey = path.posix.join(jurisdictionId, "estimates", `${sha256}.jpg`);
  const filePath = path.join(dir, `${sha256}.jpg`);
  // Content-addressed (same convention as app/api/capture/sync/route.ts's
  // writePhotoFile): writing identical bytes to the same path on a retried
  // upload is a safe no-op.
  await writeFile(filePath, Buffer.from(base64, "base64"));
  return storageKey;
}

/**
 * Uploads a new estimate document version for an assessment. spec §8.3:
 * "one estimate = one document record with explicit version... never merge
 * numbers across uploads" — this ALWAYS inserts a new row; a prior version
 * for the same assessment is never updated, and the new row's
 * `supersedes_estimate_id` links back to it. OCR (if it ran client-side) is
 * passed in already-extracted as `input.extracted`; this function does not
 * run OCR itself (tesseract.js is browser-only — see
 * docs/adr/0007-ocr-estimate-intake.md) — it only re-verifies and persists
 * what the client claims.
 *
 * Hash re-verification (spec's implicit requirement, matching
 * app/api/capture/sync/route.ts's photo handling): every page's claimed
 * sha256 is checked against the actual received bytes BEFORE anything is
 * written. A single mismatched page rejects the whole upload — never a
 * partial write of unverified bytes.
 *
 * Upload hardening (per docs/security-review.md's W3 audit, coordinated
 * 2026-08-17 — this module had the size-cap/magic-byte checks
 * app/api/capture/sync/route.ts already had, added here to close the same
 * gap for estimate documents): every page is size-capped at
 * `MAX_PHOTO_BYTES` and signature-sniffed as a real JPEG via
 * `sniffImageType()` — the client-declared `contentType: "image/jpeg"` is a
 * claim (attacker-controlled request-body text), not proof; per the OWASP
 * File Upload Cheat Sheet (retrieved 2026-08-17, cited in
 * upload-validation.ts): "Don't rely on the Content-Type header." Reusing
 * the SAME shared constant/function `app/api/capture/sync/route.ts` uses,
 * not a duplicate — estimate pages go through the identical client-side
 * downscale pipeline (`processEstimatePage` -> `processPhoto`, same ~1600px
 * JPEG output profile), so the same 8MB/page ceiling applies honestly.
 */
export async function createEstimateVersion(
  jurisdictionId: string,
  userId: string | null,
  clientId: string,
  input: CreateEstimateInput,
): Promise<CreateEstimateResult> {
  for (let i = 0; i < input.pages.length; i++) {
    const page = input.pages[i];
    if (!page) continue;
    const bytes = Buffer.from(page.dataBase64, "base64");
    if (bytes.length > MAX_PHOTO_BYTES) {
      return { status: "too_large", pageIndex: i };
    }
    if (sniffImageType(bytes) !== "jpeg") {
      return { status: "invalid_image_type", pageIndex: i };
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== page.sha256.toLowerCase()) {
      return { status: "hash_mismatch", pageIndex: i };
    }
  }

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(`select id from assessments where client_id = $1`, [clientId]);
    if (assessmentRes.rows.length === 0) return { status: "not_found" };
    const assessmentId = assessmentRes.rows[0].id as string;

    const storageKeys: string[] = [];
    for (const page of input.pages) {
      storageKeys.push(await writeEstimatePageFile(jurisdictionId, page.sha256.toLowerCase(), page.dataBase64));
    }
    const combinedHash = createHash("sha256")
      .update(combinedDocumentHashInput(input.pages.map((p) => p.sha256)))
      .digest("hex");

    const latestRes = await client.query(
      `select id, version from estimates where assessment_id = $1 order by version desc limit 1`,
      [assessmentId],
    );
    const latest = latestRes.rows[0] as { id: string; version: number } | undefined;
    const newVersion = (latest?.version ?? 0) + 1;

    const insertRes = await client.query(
      `insert into estimates (
         assessment_id, jurisdiction_id, storage_key, sha256, original_filename,
         version, supersedes_estimate_id, ocr_engine, ocr_engine_version, extracted_json
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id`,
      [
        assessmentId,
        jurisdictionId,
        JSON.stringify(storageKeys),
        combinedHash,
        input.pages[0]?.originalFilename ?? null,
        newVersion,
        latest?.id ?? null,
        input.extracted?.engine ?? null,
        input.extracted?.engineVersion ?? null,
        input.extracted ? JSON.stringify(input.extracted) : null,
      ],
    );

    return { status: "ok", estimateId: insertRes.rows[0].id as string, version: newVersion };
  });
}

/**
 * Human confirmation — the ONLY code path that ever sets `confirmed_total` /
 * `confirmed_line_items` / `scope_reviewed` / `confirmed_by_user_id` /
 * `confirmed_at`. Never trusts the client's UI-side gating alone (same
 * discipline app/determination/_lib/actions.ts's adoptDetermination uses
 * for `confirmed: true`): `scope_reviewed` and a finite, positive
 * `confirmed_total` are enforced again here, server-side.
 *
 * Re-confirming an already-confirmed row is rejected — build spec §8.3's
 * "never merge numbers across uploads" extends to never silently
 * overwriting a human's prior confirmation either; a correction is a new
 * estimate version (createEstimateVersion), not a mutation of a confirmed
 * one.
 */
export async function confirmEstimate(
  jurisdictionId: string,
  userId: string | null,
  estimateId: string,
  input: ConfirmEstimateInput,
): Promise<ConfirmEstimateResult> {
  if (!input.scopeReviewed) {
    return { status: "scope_not_reviewed" };
  }
  if (!Number.isFinite(input.confirmedTotal) || input.confirmedTotal <= 0) {
    return { status: "invalid_total" };
  }

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const existing = await client.query(`select confirmed_at from estimates where id = $1`, [estimateId]);
    if (existing.rows.length === 0) return { status: "not_found" };
    if (existing.rows[0].confirmed_at !== null) return { status: "already_confirmed" };

    await client.query(
      `update estimates set
         confirmed_total = $2,
         confirmed_line_items = $3,
         scope_reviewed = $4,
         confirmed_by_user_id = $5,
         confirmed_at = now(),
         notes = $6
       where id = $1`,
      [
        estimateId,
        input.confirmedTotal,
        JSON.stringify(input.confirmedLineItems),
        input.scopeReviewed,
        userId,
        input.notes,
      ],
    );

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'estimate', $3, 'confirm', $4, $5)`,
      [
        userId,
        jurisdictionId,
        estimateId,
        JSON.stringify({ confirmed_at: null }),
        JSON.stringify({
          confirmed_total: input.confirmedTotal,
          scope_reviewed: input.scopeReviewed,
          provenance: input.provenance,
        }),
      ],
    );

    return { status: "ok" };
  });
}
