import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import path from "node:path";
import type { PoolClient } from "pg";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { withTenant } from "@/shared/db";
import { getStorageDriver } from "@/shared/storage";
import { mergeScalarFields, resolveElementMerge, type ScalarSnapshot } from "../_lib/merge";
import { checkRateLimit, rateLimitResponse } from "@/shared/security/rate-limit";

// Idempotent sync endpoint for the offline capture flow (src/core/capture/).
// Keyed on assessments.client_id (schema/core.sql unique constraint) —
// specs/constitution.md §5: "Sync endpoint is idempotent via
// assessments.client_id." A field device may retry this exact POST after a
// timeout even though the first attempt actually succeeded; every write
// here is expressed as an idempotent upsert so a retry never duplicates a
// row (verified by test/e2e/offline-capture.spec.ts's idempotency probe).
//
// Photo storage decision: photo bytes go through src/shared/storage's
// pluggable StorageDriver (STORAGE_DRIVER=local|supabase — see
// docs/adr/0008-object-storage.md), keyed content-addressed as
// <jurisdictionId>/<sha256>.jpg (so a retried/duplicate photo is a no-op
// write either driver honors), and `photos.storage_key` stores that key.
// The local driver preserves the original gitignored uploads/ filesystem
// behavior byte-for-byte; the supabase driver is what makes this route
// deployable on Vercel's ephemeral filesystem.
//
// F2 (2026-08-19, docs/journal/2026-08-19-f2-sync.md): this route no longer
// writes photo bytes itself. It used to accept them inline as base64 JSON —
// Vercel enforces a hard ~4.5MB request-body ceiling per serverless
// invocation at the platform level, reproduced live returning
// `413 FUNCTION_PAYLOAD_TOO_LARGE` (Vercel's own platform error, before this
// route's code ever ran) for a realistic multi-photo assessment. Photo
// bytes now upload individually beforehand, to
// app/api/photos/upload/[id]/route.ts (raw binary, same content-addressed
// key scheme). This route's job for each photo is now only to confirm that
// upload actually landed (`getStorageDriver().exists(...)` on the same
// deterministic key) before writing the `photos` row that references it —
// never trusting the client's claim that a photo is ready without checking.
//
// Payload is JSON, metadata only (no photo bytes) — see
// src/core/capture/payload.ts's file header for the full history/tradeoff.
//
// T-C5 added scope (specs/core/tasks.md §2.5, docs/testing/live-test-plan.md
// OT-4): a SECOND device syncing the same client_id no longer overwrites the
// whole assessment row wholesale. Scalar fields (gps/water-depth/notes) and
// each assessment_elements row are merged per field/per element via
// ../_lib/merge.ts (mergeScalarFields / resolveElementMerge) — an untouched
// field on the incoming device never clobbers what's on file, a genuinely
// new value always fills a gap, and where both devices touched the same
// field the one with the later device_captured_at wins. Photos already got
// a natural per-photo union for free (content-addressed insert `on conflict
// (id) do nothing` below, unchanged by this task). When a prior assessment
// row already existed AND the merge actually resolved a difference (either
// direction), one audit_log row is written describing which fields/elements
// were affected — never a silent conflict resolution.

const photoSchema = z.object({
  id: z.string().uuid(),
  elementCode: z.string().nullable(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i),
  capturedAt: z.string(),
  gpsLat: z.number().nullable(),
  gpsLng: z.number().nullable(),
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

// Looser than the auth routes — field devices legitimately retry with
// backoff after a dropped connection (this endpoint is designed idempotent
// specifically for that), and a device catching up after being offline for
// a while can burst several queued assessments at once. 30/min per acting
// user bounds a runaway retry loop without capping a real catch-up sync.
// See docs/security-review.md "Rate limiting".
const SYNC_LIMIT = 30;
const SYNC_WINDOW_MS = 60 * 1000;

// F2: the finalize payload is metadata only now (no photo bytes — see the
// file header) so it stays at most a few hundred KB even for a maximal
// 12-element, dozen-photo assessment. Deliberately a local constant, not
// src/shared/security/upload-validation.ts's shared MAX_SYNC_BODY_BYTES
// (48MB): that shared constant is also used by src/modules/a4-estimates'
// unrelated JSON upload flow with its own, still-legitimate size budget —
// see that file's updated comment for why this route doesn't reuse it. 2MB
// is a coarse first-line guard (checked via Content-Length before the body
// is even parsed) against a malformed or deliberately oversized JSON body,
// not a limit any real payload should approach.
const MAX_FINALIZE_BODY_BYTES = 2 * 1024 * 1024;

/** The same content-addressed key app/api/photos/upload/[id]/route.ts
 * writes to — computed here, never trusted from the client, so this route
 * can verify (not assume) that a referenced photo's bytes actually exist
 * before creating a `photos` row that points at them. */
function photoStorageKey(jurisdictionId: string, sha256: string): string {
  return path.posix.join(jurisdictionId, `${sha256.toLowerCase()}.jpg`);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const syncCheck = checkRateLimit(`sync:user:${userId}`, SYNC_LIMIT, SYNC_WINDOW_MS);
    if (!syncCheck.allowed) {
      return rateLimitResponse(syncCheck, "Too many sync requests. It will remain queued and retry.");
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_FINALIZE_BODY_BYTES) {
      return NextResponse.json({ error: "Sync payload is too large." }, { status: 413 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Malformed sync payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // F2: bytes already went through app/api/photos/upload/[id]/route.ts
    // (its own sha256 re-verification + magic-byte sniff happened there,
    // against the real received bytes — this route never sees photo bytes
    // at all anymore). What's left to verify here: that the upload this
    // payload references actually happened, by checking the real storage
    // driver for the exact content-addressed key it would have written to —
    // never trusting the client's say-so that a photo is ready. A client
    // that races ahead of its own uploads (a bug, not the documented flow —
    // src/core/capture/sync.ts gates finalize on every photo reporting
    // "uploaded" first) gets a clear, retryable error instead of a `photos`
    // row pointing at bytes that don't exist.
    const storageKeys = new Map<string, string>();
    for (const photo of body.photos) {
      const storageKey = photoStorageKey(jurisdictionId, photo.sha256);
      const uploaded = await getStorageDriver().exists(storageKey);
      if (!uploaded) {
        return NextResponse.json(
          { error: `Photo ${photo.id} was not uploaded yet. It will remain queued and retry.` },
          { status: 409 },
        );
      }
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

      // Look up whatever is already on file for this client_id BEFORE
      // writing anything, so the merge decision (mergeScalarFields /
      // resolveElementMerge) can compare against it. null = first sync ever
      // for this client_id (no merge needed, matches pre-existing
      // behavior/OT-5 idempotency exactly).
      const existingRes = await client.query(
        `select id, device_captured_at, gps_lat, gps_lng, gps_accuracy_m,
                water_depth_interior_in, water_depth_source, notes
         from assessments where client_id = $1`,
        [body.clientId],
      );
      const existingRow = existingRes.rows[0] as
        | {
            id: string;
            device_captured_at: Date | null;
            gps_lat: number | null;
            gps_lng: number | null;
            gps_accuracy_m: number | null;
            water_depth_interior_in: number | null;
            water_depth_source: string | null;
            notes: string | null;
          }
        | undefined;

      const existingScalars: ScalarSnapshot | null = existingRow
        ? {
            gpsLat: existingRow.gps_lat,
            gpsLng: existingRow.gps_lng,
            gpsAccuracyM: existingRow.gps_accuracy_m,
            waterDepthInteriorIn: existingRow.water_depth_interior_in,
            waterDepthSource: existingRow.water_depth_source,
            notes: existingRow.notes,
            deviceCapturedAt: existingRow.device_captured_at ? existingRow.device_captured_at.toISOString() : null,
          }
        : null;
      const incomingScalars: ScalarSnapshot = {
        gpsLat: body.assessment.gpsLat,
        gpsLng: body.assessment.gpsLng,
        gpsAccuracyM: body.assessment.gpsAccuracyM,
        waterDepthInteriorIn: body.assessment.waterDepthInteriorIn,
        waterDepthSource: body.assessment.waterDepthSource,
        notes: body.assessment.notes,
        deviceCapturedAt: body.assessment.deviceCapturedAt,
      };
      const { merged, changes: scalarChanges, incomingIsNewer } = mergeScalarFields(existingScalars, incomingScalars);

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
           completed_at = coalesce(excluded.completed_at, assessments.completed_at),
           sync_status = 'synced'
         returning id, (xmax = 0) as inserted`,
        [
          body.structureId,
          jurisdictionId,
          userId,
          body.clientId,
          merged.deviceCapturedAt,
          merged.gpsLat,
          merged.gpsLng,
          merged.gpsAccuracyM,
          merged.waterDepthInteriorIn,
          merged.waterDepthSource,
          merged.notes,
          body.assessment.completedAt,
        ],
      );
      const assessmentId = assessmentResult.rows[0].id as string;
      const wasAlreadySynced = assessmentResult.rows[0].inserted === false;

      // Existing per-element damage map, for resolveElementMerge's
      // "is this a real gap or a genuine conflict" decision.
      const existingDamageRes = existingRow
        ? await client.query(`select element_code, damage_pct from assessment_elements where assessment_id = $1`, [
            assessmentId,
          ])
        : { rows: [] as { element_code: string; damage_pct: number }[] };
      const existingDamage: Record<string, number> = {};
      for (const row of existingDamageRes.rows) {
        existingDamage[row.element_code] = Number(row.damage_pct);
      }
      const { toWrite: elementsToWrite, changes: elementChanges } = resolveElementMerge(
        existingDamage,
        body.elements,
        incomingIsNewer,
      );

      for (const element of elementsToWrite) {
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

      // A genuine multi-device merge event: a prior assessment row already
      // existed AND the merge actually resolved at least one field/element
      // difference (in either direction — including "kept the existing,
      // newer value" cases, which are exactly the conflicts this task's
      // acceptance check needs to see in the audit trail). A same-payload
      // retry (OT-5) produces zero changes here and stays silent, as before.
      if (existingRow && (scalarChanges.length > 0 || elementChanges.length > 0)) {
        await client.query(
          `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
           values ($1, $2, 'assessment', $3, 'multi_device_merge', $4, $5)`,
          [
            userId,
            jurisdictionId,
            assessmentId,
            JSON.stringify({ scalarFields: scalarChanges.map((c) => ({ field: c.field, value: c.before })) }),
            JSON.stringify({
              scalarFields: scalarChanges.map((c) => ({ field: c.field, value: c.after })),
              elements: elementChanges.map((c) => ({ elementCode: c.elementCode, before: c.before, after: c.after })),
              incomingDeviceCapturedAt: body.assessment.deviceCapturedAt,
              incomingWasNewer: incomingIsNewer,
            }),
          ],
        );
      }

      for (const photo of body.photos) {
        const storageKey = storageKeys.get(photo.id);
        if (!storageKey) continue;
        // T-C7 (migrations/0004_photos_element_code.sql): persist which
        // element this photo belongs to. Client-side, the required exterior
        // shot is recorded with elementCode: null (src/core/capture/types.ts
        // PhotoRecord doc comment: "null = the required exterior shot") — map
        // that specific, known case to the literal 'exterior' element_code
        // per task instructions, rather than leaving it null (null is
        // reserved for genuinely unknown/legacy rows with no client-side
        // association at all, e.g. anything synced before this migration).
        const elementCode = photo.elementCode ?? "exterior";
        await client.query(
          `insert into photos (
             id, assessment_id, jurisdiction_id, storage_key, sha256, captured_at, gps_lat, gps_lng, element_code
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
            elementCode,
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
