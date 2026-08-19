// Tenant-scoped DB reads for G4 intelligence. Every query goes through
// withTenant() (src/shared/db), same pattern src/core/determination/queries.ts
// and src/modules/a2-dashboard/queries.ts already establish.
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { getReviewQueue } from "@/core/determination";
import type { ReviewQueueRow } from "@/core/determination";
import { computeTriageScore, spread, type TriageRawInput } from "./pure";
import type { ExposureRollup, TriageQueueRow, TriageScoreBreakdown } from "./types";

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * One extra query beyond src/core/determination's own getReviewQueue: the
 * three fields the triage score needs that ReviewQueueRow doesn't carry
 * (structures.improvement_value, assessments.water_depth_interior_in,
 * structures.sfha_zone). Kept separate rather than duplicating
 * determination's whole queue query, so this module never has to agree with
 * (or drift from) that module's bucket/sort logic beyond importing
 * queueBucket itself (src/core/intelligence/pure.ts sortTriageQueue).
 */
async function getTriageRawInputs(
  client: PoolClient,
  assessmentIds: readonly string[],
): Promise<Map<string, TriageRawInput>> {
  const result = new Map<string, TriageRawInput>();
  if (assessmentIds.length === 0) return result;
  const { rows } = await client.query(
    `select a.id as assessment_id, s.improvement_value, a.water_depth_interior_in, s.sfha_zone
     from assessments a
     join structures s on s.id = a.structure_id
     where a.id = any($1::uuid[])`,
    [assessmentIds],
  );
  for (const row of rows) {
    result.set(row.assessment_id as string, {
      improvementValue: toNullableNumber(row.improvement_value),
      waterDepthInteriorIn: toNullableNumber(row.water_depth_interior_in),
      sfhaZone: (row.sfha_zone as string | null) ?? null,
    });
  }
  return result;
}

/**
 * The review queue (src/core/determination's getReviewQueue, unchanged —
 * BORDERLINE > SD > NOT_SD > no-calculation stays the primary sort) with a
 * triage score attached to every row, computed against the min/max
 * improvement value and water depth CURRENTLY in this same queue (read-time
 * only — never a fixed external constant, never cached, never persisted).
 */
export async function getTriageQueue(jurisdictionId: string, userId: string | null): Promise<TriageQueueRow[]> {
  // Two separate withTenant transactions (not one nested call) — getReviewQueue
  // already opens and RLS-scopes its own connection; reusing that pattern
  // here rather than nesting keeps each query's transaction independent and
  // matches how app/ pages already compose multiple core queries in
  // Promise.all (e.g. app/dashboard/page.tsx).
  const rows: ReviewQueueRow[] = await getReviewQueue(jurisdictionId, userId);

  const raw = await withTenant(jurisdictionId, userId, (client: PoolClient) =>
    getTriageRawInputs(
      client,
      rows.map((r) => r.assessmentId),
    ),
  );

  const valueSpread = spread(rows.map((r) => raw.get(r.assessmentId)?.improvementValue ?? null));
  const depthSpread = spread(rows.map((r) => raw.get(r.assessmentId)?.waterDepthInteriorIn ?? null));

  const scores = new Map<string, TriageScoreBreakdown>();
  for (const row of rows) {
    const rawInput = raw.get(row.assessmentId) ?? { improvementValue: null, waterDepthInteriorIn: null, sfhaZone: null };
    scores.set(row.assessmentId, computeTriageScore(row.ratio, rawInput, valueSpread, depthSpread));
  }

  return rows.map((row) => ({ row, score: scores.get(row.assessmentId)! }));
}

/**
 * Distance in meters between one assessment's recorded GPS fix
 * (assessments.gps_lat/gps_lng) and its structure's stored point geometry
 * (structures.geom — the parcel centroid loaded by scripts/preprocess,
 * AGENTS.md's "geospatial" rule). This is a single ST_Distance comparison
 * between two already-stored points for one row, computed at request time —
 * NOT a spatial join and NOT opening a raster, so it stays inside "the
 * serving path reads rows" (AGENTS.md). Returns null when either point is
 * missing, never a fabricated distance.
 */
export async function getGpsDistanceMeters(
  jurisdictionId: string,
  userId: string | null,
  assessmentId: string,
): Promise<number | null> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select
         ST_Distance(
           ST_SetSRID(ST_MakePoint(a.gps_lng, a.gps_lat), 4326)::geography,
           s.geom::geography
         ) as distance_m
       from assessments a
       join structures s on s.id = a.structure_id
       where a.id = $1
         and a.gps_lat is not null
         and a.gps_lng is not null
         and s.geom is not null`,
      [assessmentId],
    );
    if (rows.length === 0) return null;
    return toNullableNumber(rows[0].distance_m);
  });
}

/**
 * Sum of `calculations.total_repair_cost` (latest calculation per structure)
 * across every structure whose latest determination is absent or still
 * `draft` — the "money sitting in the queue" a manager would ask about
 * (task instructions). Built on the same latest-assessment/latest-calc/
 * latest-determination shape src/modules/a2-dashboard/queries.ts's
 * LATEST_STATE_CTE already uses, reimplemented here (rather than imported)
 * because that module lives in a different family (src/modules) this
 * module may not reach into except through its own index.ts, and its
 * OperationalSummary type doesn't carry an "unreviewed" cut — this is a new,
 * narrower query purpose-built for that cut.
 */
export async function getExposureRollup(jurisdictionId: string, userId: string | null): Promise<ExposureRollup> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `with latest_assessment as (
         select distinct on (a.structure_id) a.id, a.structure_id
         from assessments a
         where a.completed_at is not null
         order by a.structure_id, a.completed_at desc
       ),
       latest_calc as (
         select distinct on (c.assessment_id) c.assessment_id, c.total_repair_cost
         from calculations c
         order by c.assessment_id, c.computed_at desc
       ),
       latest_det as (
         select distinct on (x.assessment_id) x.assessment_id, x.status
         from (
           select d.status, d.created_at, c.assessment_id
           from determinations d
           join calculations c on c.id = d.calculation_id
         ) x
         order by x.assessment_id, x.created_at desc
       )
       select
         count(*) filter (where lc.total_repair_cost is not null)::int as unreviewed_count,
         sum(lc.total_repair_cost) as unreviewed_total
       from latest_assessment la
       join latest_calc lc on lc.assessment_id = la.id
       left join latest_det ld on ld.assessment_id = la.id
       where ld.status is null or ld.status = 'draft'`,
    );
    const row = rows[0] ?? { unreviewed_count: 0, unreviewed_total: null };
    return {
      unreviewedCount: Number(row.unreviewed_count ?? 0),
      unreviewedExposureTotal: toNullableNumber(row.unreviewed_total),
    };
  });
}
