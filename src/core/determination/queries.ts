// Read-only queries for the M4 official review workflow. Every query is
// jurisdiction-scoped through withTenant() (RLS-enforced), same pattern
// src/core/registry/queries.ts already establishes.
//
// Mutations (override, adopt, supersede) are NOT here — they need to call
// the M3 engine-persistence helper (app/calculation/_lib/compute.ts), which
// lives under app/, and src/core/* may only import a DIFFERENT core family
// through its index.ts (eslint-plugin-boundaries, docs/adr/0003) — it may
// never import from app/. Those mutations live in
// app/determination/_lib/actions.ts instead, which is free to import both
// this module's index.ts AND the sibling app/calculation/_lib helper
// (app-to-app imports are unrestricted — see docs/journal/2026-08-17-c5-determination.md).
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { runEngine } from "@/core/engine";
import type { EngineCostTable } from "@/core/engine";
import { elementsForOccupancy, type Occupancy } from "@/core/capture";
import { readAppealWindowDays } from "./pure";
import type {
  AuditLogRow,
  DeterminationStatus,
  ReviewDetail,
  ReviewDetailResult,
  ReviewPhoto,
  ReviewQueueRow,
} from "./types";

function toThresholdResult(value: unknown): "SD" | "NOT_SD" | "BORDERLINE" | null {
  return value === "SD" || value === "NOT_SD" || value === "BORDERLINE" ? value : null;
}

function toDeterminationStatus(value: unknown): DeterminationStatus | null {
  return value === "draft" || value === "adopted" || value === "contested" || value === "superseded"
    ? value
    : null;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toIsoDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

/**
 * Official review queue: every completed assessment, its latest calculation
 * (if any), and the latest determination tied to any of that assessment's
 * calculations (if any). Sorted BORDERLINE > SD > NOT_SD > no-calculation
 * (task instructions, src/core/determination/pure.ts's compareQueueRows) —
 * sorting is done in SQL directly so pagination/limit stays correct; the
 * pure comparator is unit-tested independently and re-verified here by the
 * integration test.
 */
export async function getReviewQueue(
  jurisdictionId: string,
  userId: string | null,
): Promise<ReviewQueueRow[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select
         a.id as assessment_id,
         a.client_id,
         a.structure_id,
         s.address,
         a.completed_at,
         c.id as calculation_id,
         c.ratio,
         c.threshold_result,
         c.calc_count,
         d.id as determination_id,
         d.status as determination_status
       from assessments a
       join structures s on s.id = a.structure_id
       left join lateral (
         select c1.id, c1.ratio, c1.threshold_result,
                (select count(*)::int from calculations c4 where c4.assessment_id = a.id) as calc_count
         from calculations c1
         where c1.assessment_id = a.id
         order by c1.computed_at desc
         limit 1
       ) c on true
       left join lateral (
         select d1.id, d1.status
         from determinations d1
         join calculations c2 on c2.id = d1.calculation_id
         where c2.assessment_id = a.id
         order by d1.created_at desc
         limit 1
       ) d on true
       where a.completed_at is not null
       order by
         case
           when c.threshold_result = 'BORDERLINE' then 0
           when c.threshold_result = 'SD' then 1
           when c.threshold_result = 'NOT_SD' then 2
           else 3
         end,
         a.completed_at asc`,
    );

    return rows.map((row): ReviewQueueRow => ({
      assessmentId: row.assessment_id as string,
      clientId: row.client_id as string,
      structureId: row.structure_id as string,
      address: row.address as string,
      completedAt: toIso(row.completed_at),
      calculationId: (row.calculation_id as string | null) ?? null,
      ratio: row.ratio === null ? null : Number(row.ratio),
      thresholdResult: toThresholdResult(row.threshold_result),
      calculationCount: row.calc_count === null ? 0 : Number(row.calc_count),
      determinationId: (row.determination_id as string | null) ?? null,
      determinationStatus: toDeterminationStatus(row.determination_status),
    }));
  });
}

/**
 * Full review detail for one assessment (by client_id, matching the URL
 * scheme app/calculation/[clientId] already uses): every input the task
 * requires visible — per-element damage %/cost, photos, water depth+source,
 * GPS+accuracy, value used+source, cost table version+citation, engine
 * version, ratio+band, plus any determination already on record and the
 * jurisdiction's configured appeal-window days (or null, honestly).
 */
export async function getReviewDetail(
  jurisdictionId: string,
  userId: string | null,
  clientId: string,
): Promise<ReviewDetailResult> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(
      `select a.id as assessment_id, a.client_id, a.structure_id, a.completed_at,
              a.gps_lat, a.gps_lng, a.gps_accuracy_m,
              a.water_depth_interior_in, a.water_depth_source, a.notes,
              s.address, s.occupancy_type
       from assessments a
       join structures s on s.id = a.structure_id
       where a.client_id = $1`,
      [clientId],
    );
    if (assessmentRes.rows.length === 0) return { status: "not_found" };
    const a = assessmentRes.rows[0];
    const assessmentId = a.assessment_id as string;
    const occupancyType = a.occupancy_type as Occupancy | null;

    const calcRes = await client.query(
      `select * from calculations where assessment_id = $1 order by computed_at desc limit 1`,
      [assessmentId],
    );
    if (calcRes.rows.length === 0 || occupancyType === null) {
      return { status: "no_calculation", structureId: a.structure_id as string, address: a.address as string };
    }
    const calc = calcRes.rows[0];

    const priorCountRes = await client.query(
      `select count(*)::int as n from calculations where assessment_id = $1`,
      [assessmentId],
    );

    const costTableRes = await client.query(
      `select version, source_citation, json_payload from cost_tables where version = $1`,
      [calc.cost_table_version],
    );

    const damageRes = await client.query(
      `select element_code, damage_pct from assessment_elements where assessment_id = $1`,
      [assessmentId],
    );
    const damage: Record<string, number> = {};
    for (const row of damageRes.rows) {
      damage[row.element_code as string] = Number(row.damage_pct);
    }

    // T-C7 (migrations/0004_photos_element_code.sql): element_code travels
    // with every photo now; every photo for this assessment, still one flat
    // list (grouping by element happens at the presentation layer — see
    // app/determination/[clientId]/page.tsx).
    const photoRes = await client.query(
      `select id, captured_at, gps_lat, gps_lng, caption, element_code
       from photos where assessment_id = $1 order by captured_at asc nulls last`,
      [assessmentId],
    );
    const allPhotos: ReviewPhoto[] = photoRes.rows.map((row) => ({
      id: row.id as string,
      capturedAt: toIso(row.captured_at),
      gpsLat: row.gps_lat === null ? null : Number(row.gps_lat),
      gpsLng: row.gps_lng === null ? null : Number(row.gps_lng),
      caption: (row.caption as string | null) ?? null,
      elementCode: (row.element_code as string | null) ?? null,
    }));

    const elementDefs = elementsForOccupancy(occupancyType);
    let elements: ReviewDetail["elements"] = elementDefs.map((def) => ({
      elementCode: def.code,
      elementName: def.name,
      damagePct: damage[def.code] ?? 0,
      baseCost: 0,
      computedCost: 0,
    }));

    if (costTableRes.rows.length > 0) {
      const costTableRow = costTableRes.rows[0];
      const costTable: EngineCostTable = {
        version: costTableRow.version as string,
        base_cost_per_sqft: (costTableRow.json_payload as { base_cost_per_sqft: EngineCostTable["base_cost_per_sqft"] })
          .base_cost_per_sqft,
      };
      const sqFtRes = await client.query(`select sq_ft from structures where id = $1`, [a.structure_id]);
      const sqFt = Number(sqFtRes.rows[0]?.sq_ft ?? 0);
      const engineResult = runEngine({
        occupancy: occupancyType,
        sq_ft: sqFt,
        market_value_used: Number(calc.market_value_used),
        damage,
        cost_table: costTable,
      });
      const byCode = new Map(engineResult.elements.map((e) => [e.element_code, e]));
      elements = elementDefs.map((def) => {
        const engineRow = byCode.get(def.code);
        return {
          elementCode: def.code,
          elementName: def.name,
          damagePct: damage[def.code] ?? 0,
          baseCost: engineRow?.base_cost ?? 0,
          computedCost: engineRow?.computed_cost ?? 0,
        };
      });
    }

    const determinationRes = await client.query(
      `select d.id, d.status, d.adopted_at, d.appeal_deadline_date, d.notes, d.created_at, u.email as adopted_by_email
       from determinations d
       join calculations c2 on c2.id = d.calculation_id
       left join users u on u.id = d.adopted_by_user_id
       where c2.assessment_id = $1
       order by d.created_at desc
       limit 1`,
      [assessmentId],
    );

    const jurisdictionRes = await client.query(
      `select letterhead_config from jurisdictions where id = $1`,
      [jurisdictionId],
    );
    const appealWindowConfiguredDays = readAppealWindowDays(jurisdictionRes.rows[0]?.letterhead_config ?? null);

    const detail: ReviewDetail = {
      assessmentId,
      clientId: a.client_id as string,
      structureId: a.structure_id as string,
      address: a.address as string,
      occupancyType,
      completedAt: toIso(a.completed_at),
      gpsLat: a.gps_lat === null ? null : Number(a.gps_lat),
      gpsLng: a.gps_lng === null ? null : Number(a.gps_lng),
      gpsAccuracyM: a.gps_accuracy_m === null ? null : Number(a.gps_accuracy_m),
      waterDepthInteriorIn: a.water_depth_interior_in === null ? null : Number(a.water_depth_interior_in),
      waterDepthSource: (a.water_depth_source as string | null) ?? null,
      notes: (a.notes as string | null) ?? null,
      calculationId: calc.id as string,
      totalRepairCost: Number(calc.total_repair_cost),
      marketValueUsed: Number(calc.market_value_used),
      valueSource: calc.value_source as string,
      ratio: Number(calc.ratio),
      thresholdResult: calc.threshold_result as ReviewDetail["thresholdResult"],
      costTableVersion: calc.cost_table_version as string,
      costTableSourceCitation: (costTableRes.rows[0]?.source_citation as string | undefined) ?? null,
      engineVersion: calc.engine_version as string,
      computedAt: toIso(calc.computed_at),
      priorCalculationCount: (priorCountRes.rows[0].n as number) - 1,
      elements,
      photos: allPhotos,
      determination:
        determinationRes.rows.length > 0
          ? {
              id: determinationRes.rows[0].id as string,
              status: determinationRes.rows[0].status as DeterminationStatus,
              adoptedByEmail: (determinationRes.rows[0].adopted_by_email as string | null) ?? null,
              adoptedAt: determinationRes.rows[0].adopted_at ? toIso(determinationRes.rows[0].adopted_at) : null,
              appealDeadlineDate: toIsoDateOrNull(determinationRes.rows[0].appeal_deadline_date),
              notes: (determinationRes.rows[0].notes as string | null) ?? null,
              createdAt: toIso(determinationRes.rows[0].created_at),
            }
          : null,
      appealWindowConfiguredDays,
    };

    return { status: "ok", detail };
  });
}

/** Audit trail for one assessment: every assessment_element override, every
 * structure value override, and every determination insert/update tied to
 * this assessment's calculations — the "audit chain" LT-3/LT-6 assert
 * against, surfaced in the review screen so an official can see the history
 * behind a "recalculated — see history" note. */
export async function listAuditLogForAssessment(
  jurisdictionId: string,
  userId: string | null,
  assessmentId: string,
): Promise<AuditLogRow[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select al.id, al.actor_user_id, u.email as actor_email, al.entity_type, al.entity_id,
              al.action, al.before_json, al.after_json, al.at
       from audit_log al
       left join users u on u.id = al.actor_user_id
       where
         (al.entity_type = 'assessment_element'
            and al.entity_id in (select id from assessment_elements where assessment_id = $1))
         or (al.entity_type = 'structure'
            and al.entity_id = (select structure_id from assessments where id = $1))
         or (al.entity_type = 'determination'
            and al.entity_id in (
              select d.id from determinations d
              join calculations c on c.id = d.calculation_id
              where c.assessment_id = $1
            ))
       order by al.at asc`,
      [assessmentId],
    );
    return rows.map((row): AuditLogRow => ({
      id: String(row.id),
      actorUserId: (row.actor_user_id as string | null) ?? null,
      actorEmail: (row.actor_email as string | null) ?? null,
      entityType: row.entity_type as string,
      entityId: (row.entity_id as string | null) ?? null,
      action: row.action as string,
      beforeJson: row.before_json,
      afterJson: row.after_json,
      at: toIso(row.at),
    }));
  });
}
