// Tenant-scoped DB fetch for the SDE export. Every query runs through
// withTenant() (RLS-enforced), same pattern src/core/determination/queries.ts
// and src/core/registry/queries.ts already establish. This module reaches
// core only through core index.ts entry points (eslint-plugin-boundaries,
// docs/adr/0003) — src/core/engine and src/core/capture here.
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { runEngine } from "@/core/engine";
import type { EngineCostTable } from "@/core/engine";
import { elementsForOccupancy, type Occupancy } from "@/core/capture";
import type { DeterminationStatus, ExportAssessmentData, ExportElement, ThresholdResult } from "./types";

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toIsoDateOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

export type ExportLookupResult =
  | { status: "not_found" }
  | { status: "no_calculation" }
  | { status: "ok"; data: ExportAssessmentData };

/**
 * Assemble every field the export needs for one assessment (looked up by
 * client_id, matching the URL scheme app/calculation/[clientId] and
 * app/determination/[clientId] already use). Requires a calculation to
 * exist — an assessment with no calculation yet has nothing to export
 * (specs/constitution.md §2's "no cost table loaded" state), reported
 * honestly as "no_calculation" rather than a partial/fabricated export.
 */
export async function getExportAssessmentData(
  jurisdictionId: string,
  userId: string | null,
  clientId: string,
): Promise<ExportLookupResult> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const data = await fetchOne(client, jurisdictionId, clientId);
    return data;
  });
}

/**
 * Every completed, calculated assessment in the jurisdiction — the input to
 * the batch CSV export. Reuses the same per-assessment assembly so the
 * batch and single-assessment paths can never drift apart.
 */
export async function getBatchExportData(
  jurisdictionId: string,
  userId: string | null,
): Promise<ExportAssessmentData[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select a.client_id
       from assessments a
       join calculations c on c.assessment_id = a.id
       where a.completed_at is not null
       group by a.client_id, a.completed_at
       order by a.completed_at asc`,
    );
    const out: ExportAssessmentData[] = [];
    for (const row of rows) {
      const result = await fetchOne(client, jurisdictionId, row.client_id as string);
      if (result.status === "ok") out.push(result.data);
    }
    return out;
  });
}

async function fetchOne(
  client: PoolClient,
  jurisdictionId: string,
  clientId: string,
): Promise<ExportLookupResult> {
  const assessmentRes = await client.query(
    `select a.id as assessment_id, a.client_id, a.structure_id, a.completed_at,
            a.gps_lat, a.gps_lng, a.gps_accuracy_m,
            a.water_depth_interior_in, a.water_depth_source,
            a.assessor_user_id, u.email as assessor_email,
            s.address, s.parcel_id, s.occupancy_type, s.sq_ft, s.stories,
            s.foundation_type, s.year_built
     from assessments a
     join structures s on s.id = a.structure_id
     left join users u on u.id = a.assessor_user_id
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
    return { status: "no_calculation" };
  }
  const calc = calcRes.rows[0];

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

  // Same recipe as src/core/determination/queries.ts's getReviewDetail: the
  // full verified element set for the occupancy (12 residential / 7
  // non-residential, docs/data-contracts/sde-cost-tables.md), undamaged
  // elements included with 0 rather than omitted, so the export always
  // shows the complete SDE breakdown.
  const elementDefs = elementsForOccupancy(occupancyType);
  let elements: ExportElement[] = elementDefs.map((def) => ({
    elementCode: def.code,
    elementName: def.name,
    damagePct: damage[def.code] ?? 0,
    baseCostPerSqft: null,
    computedCost: null,
  }));

  if (costTableRes.rows.length > 0) {
    const costTableRow = costTableRes.rows[0];
    const costTable: EngineCostTable = {
      version: costTableRow.version as string,
      base_cost_per_sqft: (
        costTableRow.json_payload as { base_cost_per_sqft: EngineCostTable["base_cost_per_sqft"] }
      ).base_cost_per_sqft,
    };
    const sqFt = Number(a.sq_ft ?? 0);
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
        baseCostPerSqft: engineRow?.base_cost ?? null,
        computedCost: engineRow?.computed_cost ?? null,
      };
    });
  }

  const determinationRes = await client.query(
    `select d.id, d.status, d.adopted_at, d.appeal_deadline_date, d.notes, u.email as adopted_by_email
     from determinations d
     join calculations c2 on c2.id = d.calculation_id
     left join users u on u.id = d.adopted_by_user_id
     where c2.assessment_id = $1
     order by d.created_at desc
     limit 1`,
    [assessmentId],
  );

  const data: ExportAssessmentData = {
    jurisdictionId,
    clientId: a.client_id as string,
    assessmentId,
    structureId: a.structure_id as string,
    address: a.address as string,
    parcelId: a.parcel_id as string,
    occupancyType,
    sqFt: a.sq_ft === null ? null : Number(a.sq_ft),
    stories: a.stories === null ? null : Number(a.stories),
    foundationType: (a.foundation_type as string | null) ?? null,
    yearBuilt: a.year_built === null ? null : Number(a.year_built),
    assessmentDate: toIso(a.completed_at),
    assessorEmail: (a.assessor_email as string | null) ?? null,
    gpsLat: a.gps_lat === null ? null : Number(a.gps_lat),
    gpsLng: a.gps_lng === null ? null : Number(a.gps_lng),
    gpsAccuracyM: a.gps_accuracy_m === null ? null : Number(a.gps_accuracy_m),
    waterDepthInteriorIn: a.water_depth_interior_in === null ? null : Number(a.water_depth_interior_in),
    waterDepthSource: (a.water_depth_source as string | null) ?? null,
    elements,
    costTableVersion: calc.cost_table_version as string,
    costTableSourceCitation: (costTableRes.rows[0]?.source_citation as string | undefined) ?? null,
    totalRepairCost: Number(calc.total_repair_cost),
    marketValueUsed: Number(calc.market_value_used),
    valueSource: calc.value_source as string,
    ratio: Number(calc.ratio),
    thresholdResult: calc.threshold_result as ThresholdResult,
    engineVersion: calc.engine_version as string,
    computedAt: toIso(calc.computed_at),
    determination:
      determinationRes.rows.length > 0
        ? {
            status: determinationRes.rows[0].status as DeterminationStatus,
            adoptedByEmail: (determinationRes.rows[0].adopted_by_email as string | null) ?? null,
            adoptedAt: determinationRes.rows[0].adopted_at ? toIso(determinationRes.rows[0].adopted_at) : null,
            appealDeadlineDate: toIsoDateOrNull(determinationRes.rows[0].appeal_deadline_date),
            notes: (determinationRes.rows[0].notes as string | null) ?? null,
          }
        : null,
  };

  return { status: "ok", data };
}
