import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { withTenant } from "@/shared/db";

// Idempotent sync endpoint for the offline capture flow (src/core/capture/).
// Keyed on assessments.client_id (schema/core.sql unique constraint) —
// specs/constitution.md §5: "Sync endpoint is idempotent via
// assessments.client_id." A field device may retry this exact POST after a
// timeout even though the first attempt actually succeeded; every write
// here is expressed as an idempotent upsert so a retry never duplicates a
// row (verified by test/e2e/offline-capture.spec.ts's idempotency probe).
//
// Photo storage decision (documented per task instructions — no schema
// change, no new dependency): Supabase storage is not wired up for this
// project yet, so photo bytes are written to the local filesystem under a
// gitignored uploads/<jurisdictionId>/<sha256>.jpg (content-addressed, so a
// retried/duplicate photo is a no-op write), and `photos.storage_key` stores
// that relative path. Swapping this for real object storage (S3/Supabase
// Storage/etc.) later is a drop-in change to writePhotoFile() below — no
// other code depends on the filesystem specifically.
//
// Payload is JSON + base64 photos, not multipart — see
// src/core/capture/payload.ts's file header for the documented tradeoff.

const photoSchema = z.object({
  id: z.string().uuid(),
  elementCode: z.string().nullable(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i),
  capturedAt: z.string(),
  gpsLat: z.number().nullable(),
  gpsLng: z.number().nullable(),
  dataBase64: z.string(),
  contentType: z.literal("image/jpeg"),
});

const bodySchema = z.object({
  clientId: z.string().min(1),
  structureId: z.string().uuid(),
  structureUpdates: z.object({
    occupancyType: z.enum(["residential", "non_residential"]).nullable(),
    sqFt: z.number().nullable(),
    stories: z.number().nullable(),
    foundationType: z.string().nullable(),
  }),
  assessment: z.object({
    gpsLat: z.number().nullable(),
    gpsLng: z.number().nullable(),
    gpsAccuracyM: z.number().nullable(),
    deviceCapturedAt: z.string().nullable(),
    waterDepthInteriorIn: z.number().nullable(),
    waterDepthSource: z
      .enum(["observed_line", "measured", "owner_reported", "modeled", "unknown"])
      .nullable(),
    notes: z.string().nullable(),
    completedAt: z.string().nullable(),
  }),
  elements: z.array(
    z.object({
      elementCode: z.string().min(1),
      damagePct: z.number().int().min(0).max(100),
    }),
  ),
  photos: z.array(photoSchema),
});

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

async function writePhotoFile(jurisdictionId: string, sha256: string, base64: string): Promise<string> {
  const dir = path.join(UPLOADS_ROOT, jurisdictionId);
  await mkdir(dir, { recursive: true });
  const storageKey = path.posix.join(jurisdictionId, `${sha256}.jpg`);
  const filePath = path.join(dir, `${sha256}.jpg`);
  const bytes = Buffer.from(base64, "base64");
  // Content-addressed: writing the same bytes to the same path is a safe
  // no-op on retry, so this does not need an existence check for
  // correctness (an existence check would only save an fs write).
  await writeFile(filePath, bytes);
  return storageKey;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Malformed sync payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Verify every photo's declared sha256 against the actual received
    // bytes before trusting it (client-computed hashes are a claim, not
    // proof — DI-4 in docs/testing/live-test-plan.md). Reject the whole
    // batch rather than silently accepting a mismatched photo.
    for (const photo of body.photos) {
      const bytes = Buffer.from(photo.dataBase64, "base64");
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      if (actualSha256 !== photo.sha256.toLowerCase()) {
        return NextResponse.json(
          { error: `Photo ${photo.id} sha256 mismatch — refusing to store unverified bytes.` },
          { status: 400 },
        );
      }
    }

    const storageKeys = new Map<string, string>();
    for (const photo of body.photos) {
      const storageKey = await writePhotoFile(jurisdictionId, photo.sha256, photo.dataBase64);
      storageKeys.set(photo.id, storageKey);
    }

    const result = await withTenant(jurisdictionId, userId, async (client: PoolClient) => {
      // Structure attribute updates captured on the attributes screen
      // (occupancy/sq_ft/stories/foundation_type) — coalesce so a field
      // that was never touched (still null in the payload) never clobbers
      // an existing value.
      await client.query(
        `update structures set
           occupancy_type = coalesce(occupancy_type, $2),
           sq_ft = coalesce($3, sq_ft),
           stories = coalesce($4, stories),
           foundation_type = coalesce($5, foundation_type)
         where id = $1`,
        [
          body.structureId,
          body.structureUpdates.occupancyType,
          body.structureUpdates.sqFt,
          body.structureUpdates.stories,
          body.structureUpdates.foundationType,
        ],
      );

      const costTableRow = await client.query(
        `select version from cost_tables
         where jurisdiction_id = $1 or jurisdiction_id is null
         order by effective_date desc limit 1`,
        [jurisdictionId],
      );
      // specs/constitution.md §2: no cost table loaded is an explicit,
      // honest runtime state, never a fabricated figure. 'NONE' is a
      // sentinel for "not yet priced" — assessment_elements.cost_table_version
      // is NOT NULL in the frozen schema, so a value is required even though
      // capture (T-C3) does no cost computation; M3 (T-C4) computes real
      // calculations rows separately once a cost table exists.
      const costTableVersion: string = costTableRow.rows[0]?.version ?? "NONE";

      const assessmentResult = await client.query(
        `insert into assessments (
           structure_id, jurisdiction_id, assessor_user_id, client_id,
           device_captured_at, gps_lat, gps_lng, gps_accuracy_m,
           water_depth_interior_in, water_depth_source, notes,
           completed_at, sync_status
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'synced')
         on conflict (client_id) do update set
           device_captured_at = excluded.device_captured_at,
           gps_lat = excluded.gps_lat,
           gps_lng = excluded.gps_lng,
           gps_accuracy_m = excluded.gps_accuracy_m,
           water_depth_interior_in = excluded.water_depth_interior_in,
           water_depth_source = excluded.water_depth_source,
           notes = excluded.notes,
           completed_at = excluded.completed_at,
           sync_status = 'synced'
         returning id, (xmax = 0) as inserted`,
        [
          body.structureId,
          jurisdictionId,
          userId,
          body.clientId,
          body.assessment.deviceCapturedAt,
          body.assessment.gpsLat,
          body.assessment.gpsLng,
          body.assessment.gpsAccuracyM,
          body.assessment.waterDepthInteriorIn,
          body.assessment.waterDepthSource,
          body.assessment.notes,
          body.assessment.completedAt,
        ],
      );
      const assessmentId = assessmentResult.rows[0].id as string;
      const wasAlreadySynced = assessmentResult.rows[0].inserted === false;

      for (const element of body.elements) {
        await client.query(
          `insert into assessment_elements (
             assessment_id, jurisdiction_id, element_code, damage_pct, cost_table_version
           ) values ($1,$2,$3,$4,$5)
           on conflict (assessment_id, element_code) do update set
             damage_pct = excluded.damage_pct,
             cost_table_version = excluded.cost_table_version`,
          [assessmentId, jurisdictionId, element.elementCode, element.damagePct, costTableVersion],
        );
      }

      for (const photo of body.photos) {
        const storageKey = storageKeys.get(photo.id);
        if (!storageKey) continue;
        await client.query(
          `insert into photos (
             id, assessment_id, jurisdiction_id, storage_key, sha256, captured_at, gps_lat, gps_lng
           ) values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (id) do nothing`,
          [
            photo.id,
            assessmentId,
            jurisdictionId,
            storageKey,
            photo.sha256.toLowerCase(),
            photo.capturedAt,
            photo.gpsLat,
            photo.gpsLng,
          ],
        );
      }

      return { assessmentId, alreadySynced: wasAlreadySynced };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[capture] sync failed:", err);
    return NextResponse.json({ error: "Sync failed. It will remain queued and retry." }, { status: 500 });
  }
}
