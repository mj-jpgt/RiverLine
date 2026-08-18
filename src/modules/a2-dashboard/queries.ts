// Tenant-scoped DB reads for the T-A2 administrator dashboard. Every query
// goes through withTenant() (src/shared/db) — RLS-enforced, same pattern
// src/core/determination/queries.ts and src/core/registry/queries.ts
// already establish (docs/agents/SUBAGENT.md "Role: data / backend agents"
// #1: application-level filtering alone is not sufficient).
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { resolveSort } from "./pure";
import type {
  CalculationBandCounts,
  CaseloadFilters,
  CaseloadPage,
  CaseloadRow,
  CaseloadSortColumn,
  DashboardCounts,
  DeterminationStatus,
  DeterminationStatusCounts,
  ExportTable,
  OccupancyBandCounts,
  OperationalSummary,
  RepairCostTotals,
  SortDirection,
} from "./types";

// The single source-of-truth CTE every count/caseload/export-row query below
// is built on: one row per structure, carrying its latest COMPLETED
// assessment (if any), that assessment's latest calculation (if any), and
// the latest determination tied to any of that assessment's calculations
// (if any). Mirrors the lateral-join shape src/core/determination/queries.ts
// already uses for getReviewQueue, generalized to "per structure" instead of
// "per assessment" because the caseload table's entity is the structure
// (task instructions: "caseload table: all structures with
// assessment/calculation/determination state").
const LATEST_STATE_CTE = `
  with latest_assessment as (
    select distinct on (a.structure_id) a.id, a.structure_id, a.completed_at
    from assessments a
    where a.completed_at is not null
    order by a.structure_id, a.completed_at desc
  ),
  latest_calc as (
    select distinct on (c.assessment_id)
      c.id, c.assessment_id, c.ratio, c.threshold_result,
      c.market_value_used, c.value_source, c.cost_table_version,
      c.total_repair_cost
    from calculations c
    order by c.assessment_id, c.computed_at desc
  ),
  latest_det as (
    select distinct on (x.assessment_id)
      x.id, x.assessment_id, x.status, x.adopted_at
    from (
      select d.id, d.status, d.adopted_at, d.created_at, c.assessment_id
      from determinations d
      join calculations c on c.id = d.calculation_id
    ) x
    order by x.assessment_id, x.created_at desc
  )
`;

const LATEST_STATE_JOIN = `
  from structures s
  left join latest_assessment la on la.structure_id = s.id
  left join latest_calc lc on lc.assessment_id = la.id
  left join latest_det ld on ld.assessment_id = la.id
`;

function toThresholdBand(value: unknown): "SD" | "NOT_SD" | "BORDERLINE" | null {
  return value === "SD" || value === "NOT_SD" || value === "BORDERLINE" ? value : null;
}

function toDeterminationStatus(value: unknown): DeterminationStatus | null {
  return value === "draft" || value === "adopted" || value === "contested" || value === "superseded"
    ? value
    : null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRow(row: Record<string, unknown>): CaseloadRow {
  return {
    structureId: row.structure_id as string,
    parcelId: row.parcel_id as string,
    address: row.address as string,
    assessmentId: (row.assessment_id as string | null) ?? null,
    completedAt: toIsoOrNull(row.completed_at),
    ratio: row.ratio === null || row.ratio === undefined ? null : Number(row.ratio),
    band: toThresholdBand(row.threshold_result),
    marketValueUsed: row.market_value_used === null || row.market_value_used === undefined ? null : Number(row.market_value_used),
    valueSource: (row.value_source as string | null) ?? null,
    costTableVersion: (row.cost_table_version as string | null) ?? null,
    determinationId: (row.determination_id as string | null) ?? null,
    determinationStatus: toDeterminationStatus(row.determination_status),
    adoptedAt: toIsoOrNull(row.adopted_at),
  };
}

/** Builds the WHERE clause + params shared by getCaseload/getCaseloadForExport
 * — filters compose (search AND status AND band AND date-range), every
 * value is a bound $-parameter, never string-concatenated. `status`/`band`
 * are already whitelisted to a fixed literal union by their TypeScript type
 * (CaseloadFilters), and callers (app/dashboard/page.tsx,
 * app/dashboard/export/*) resolve raw query-string values through
 * resolveStatusFilter/resolveBandFilter (pure.ts) before this function ever
 * sees them — this function additionally never trusts the type alone for
 * `status`/`band`, it maps them explicitly below. */
function buildWhere(filters: CaseloadFilters, startIndex: number): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;

  if (filters.search) {
    clauses.push(`s.address ilike '%' || $${i++} || '%'`);
    params.push(filters.search);
  }

  if (filters.status === "NONE") {
    clauses.push(`ld.status is null`);
  } else if (filters.status === "draft" || filters.status === "adopted" || filters.status === "contested" || filters.status === "superseded") {
    clauses.push(`ld.status = $${i++}`);
    params.push(filters.status);
  }
  // "ALL" adds no clause.

  if (filters.band === "NONE") {
    clauses.push(`lc.threshold_result is null`);
  } else if (filters.band === "SD" || filters.band === "BORDERLINE" || filters.band === "NOT_SD") {
    clauses.push(`lc.threshold_result = $${i++}`);
    params.push(filters.band);
  }

  if (filters.dateFrom) {
    clauses.push(`la.completed_at >= $${i++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    clauses.push(`la.completed_at < ($${i++}::date + interval '1 day')`);
    params.push(filters.dateTo);
  }

  return { clause: clauses.length > 0 ? `where ${clauses.join(" and ")}` : "", params };
}

const CASELOAD_SELECT = `
  select
    s.id as structure_id, s.parcel_id, s.address,
    la.id as assessment_id, la.completed_at,
    lc.ratio, lc.threshold_result, lc.market_value_used, lc.value_source, lc.cost_table_version,
    ld.id as determination_id, ld.status as determination_status, ld.adopted_at
`;

export async function getCaseload(
  jurisdictionId: string,
  userId: string | null,
  filters: CaseloadFilters,
  sortColumn: CaseloadSortColumn,
  direction: SortDirection,
  page: number,
  pageSize: number,
): Promise<CaseloadPage> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { sql: sortSql } = resolveSort(sortColumn, direction);
    const { clause, params } = buildWhere(filters, 1);

    const countRes = await client.query(
      `${LATEST_STATE_CTE} select count(*)::int as n ${LATEST_STATE_JOIN} ${clause}`,
      params,
    );
    const totalCount = countRes.rows[0].n as number;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const offset = (page - 1) * pageSize;
    const { rows } = await client.query(
      `${LATEST_STATE_CTE} ${CASELOAD_SELECT} ${LATEST_STATE_JOIN} ${clause}
       order by ${sortSql} ${direction === "asc" ? "asc" : "desc"} nulls last, s.id asc
       limit $${limitIdx} offset $${offsetIdx}`,
      [...params, pageSize, offset],
    );

    return { rows: rows.map(toRow), totalCount, page, pageSize };
  });
}

/** Same filtered view as getCaseload but unpaginated — the CSV export
 * streams "the current filtered view" in full (task instructions), not one
 * page of it. */
export async function getCaseloadForExport(
  jurisdictionId: string,
  userId: string | null,
  filters: CaseloadFilters,
  sortColumn: CaseloadSortColumn,
  direction: SortDirection,
): Promise<CaseloadRow[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { sql: sortSql } = resolveSort(sortColumn, direction);
    const { clause, params } = buildWhere(filters, 1);
    const { rows } = await client.query(
      `${LATEST_STATE_CTE} ${CASELOAD_SELECT} ${LATEST_STATE_JOIN} ${clause}
       order by ${sortSql} ${direction === "asc" ? "asc" : "desc"} nulls last, s.id asc`,
      params,
    );
    return rows.map(toRow);
  });
}

export async function getDashboardCounts(jurisdictionId: string, userId: string | null): Promise<DashboardCounts> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const totalRes = await client.query(`select count(*)::int as n from structures`);
    const totalStructures = totalRes.rows[0].n as number;

    const statusRes = await client.query(
      `${LATEST_STATE_CTE}
       select
         count(*) filter (where ld.status = 'draft')::int as draft,
         count(*) filter (where ld.status = 'adopted')::int as adopted,
         count(*) filter (where ld.status = 'contested')::int as contested,
         count(*) filter (where ld.status = 'superseded')::int as superseded,
         count(*) filter (where ld.status is null)::int as none
       ${LATEST_STATE_JOIN}`,
    );
    const s = statusRes.rows[0];
    const byDeterminationStatus: DeterminationStatusCounts = {
      draft: s.draft as number,
      adopted: s.adopted as number,
      contested: s.contested as number,
      superseded: s.superseded as number,
      none: s.none as number,
    };

    const bandRes = await client.query(
      `${LATEST_STATE_CTE}
       select
         count(*) filter (where lc.threshold_result = 'SD')::int as sd,
         count(*) filter (where lc.threshold_result = 'BORDERLINE')::int as borderline,
         count(*) filter (where lc.threshold_result = 'NOT_SD')::int as not_sd,
         count(*) filter (where lc.threshold_result is null)::int as no_calc
       ${LATEST_STATE_JOIN}`,
    );
    const b = bandRes.rows[0];
    const byCalculationBand: CalculationBandCounts = {
      SD: b.sd as number,
      BORDERLINE: b.borderline as number,
      NOT_SD: b.not_sd as number,
      noCalculation: b.no_calc as number,
    };

    return { byDeterminationStatus, byCalculationBand, totalStructures };
  });
}

// --- Operational summary (V5 task 3) -----------------------------------
//
// "The jurisdiction operational picture" — the numbers an EMA/county would
// actually ask for during an event (damage-category totals by occupancy,
// total computed repair-cost exposure, count of ADOPTED SD determinations
// specifically, not merely computed-SD). Built on the same LATEST_STATE_CTE
// every other query in this file uses, so "latest" means the same thing
// everywhere: one row per structure, its latest completed assessment's
// latest calculation and latest determination.

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toOccupancyBandCounts(rows: Record<string, unknown>[]): OccupancyBandCounts {
  const bucket = (occupancy: "residential" | "non_residential" | "unknown"): CalculationBandCounts => {
    const row = rows.find((r) => r.occupancy === occupancy);
    return {
      SD: row ? Number(row.sd) : 0,
      BORDERLINE: row ? Number(row.borderline) : 0,
      NOT_SD: row ? Number(row.not_sd) : 0,
      noCalculation: row ? Number(row.no_calc) : 0,
    };
  };
  return {
    residential: bucket("residential"),
    nonResidential: bucket("non_residential"),
    unknownOccupancy: bucket("unknown"),
  };
}

export async function getOperationalSummary(jurisdictionId: string, userId: string | null): Promise<OperationalSummary> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const totalRes = await client.query(`select count(*)::int as n from structures`);
    const totalStructures = totalRes.rows[0].n as number;

    const statusRes = await client.query(
      `${LATEST_STATE_CTE}
       select
         count(*) filter (where ld.status = 'draft')::int as draft,
         count(*) filter (where ld.status = 'adopted')::int as adopted,
         count(*) filter (where ld.status = 'contested')::int as contested,
         count(*) filter (where ld.status = 'superseded')::int as superseded,
         count(*) filter (where ld.status is null)::int as none,
         count(*) filter (where ld.status = 'adopted' and lc.threshold_result = 'SD')::int as adopted_sd
       ${LATEST_STATE_JOIN}`,
    );
    const s = statusRes.rows[0];
    const byDeterminationStatus: DeterminationStatusCounts = {
      draft: s.draft as number,
      adopted: s.adopted as number,
      contested: s.contested as number,
      superseded: s.superseded as number,
      none: s.none as number,
    };
    const adoptedSdCount = s.adopted_sd as number;

    const bandRes = await client.query(
      `${LATEST_STATE_CTE}
       select
         count(*) filter (where lc.threshold_result = 'SD')::int as sd,
         count(*) filter (where lc.threshold_result = 'BORDERLINE')::int as borderline,
         count(*) filter (where lc.threshold_result = 'NOT_SD')::int as not_sd,
         count(*) filter (where lc.threshold_result is null)::int as no_calc,
         sum(lc.total_repair_cost) filter (where lc.threshold_result = 'SD') as cost_sd,
         sum(lc.total_repair_cost) filter (where lc.threshold_result = 'BORDERLINE') as cost_borderline,
         sum(lc.total_repair_cost) filter (where lc.threshold_result = 'NOT_SD') as cost_not_sd,
         sum(lc.total_repair_cost) as cost_total
       ${LATEST_STATE_JOIN}`,
    );
    const b = bandRes.rows[0];
    const byCalculationBand: CalculationBandCounts = {
      SD: b.sd as number,
      BORDERLINE: b.borderline as number,
      NOT_SD: b.not_sd as number,
      noCalculation: b.no_calc as number,
    };
    const totalComputedRepairCost: RepairCostTotals = {
      total: toNullableNumber(b.cost_total),
      SD: toNullableNumber(b.cost_sd),
      BORDERLINE: toNullableNumber(b.cost_borderline),
      NOT_SD: toNullableNumber(b.cost_not_sd),
    };

    const occupancyRes = await client.query(
      `${LATEST_STATE_CTE}
       select
         coalesce(s.occupancy_type, 'unknown') as occupancy,
         count(*) filter (where lc.threshold_result = 'SD')::int as sd,
         count(*) filter (where lc.threshold_result = 'BORDERLINE')::int as borderline,
         count(*) filter (where lc.threshold_result = 'NOT_SD')::int as not_sd,
         count(*) filter (where lc.threshold_result is null)::int as no_calc
       ${LATEST_STATE_JOIN}
       group by coalesce(s.occupancy_type, 'unknown')`,
    );
    const byOccupancyAndBand = toOccupancyBandCounts(occupancyRes.rows);

    return { totalStructures, byDeterminationStatus, byCalculationBand, byOccupancyAndBand, totalComputedRepairCost, adoptedSdCount };
  });
}

// --- Records-request full export (spec §7.6) --------------------------

/** Every tenant-scoped table, in a stable, documented order. Table names
 * are a fixed literal array — never derived from request input — so this
 * can safely be interpolated into `select * from <table>`. RLS (already
 * enforced by withTenant's SET LOCAL ROLE) does the actual jurisdiction
 * scoping for every one of these; no WHERE jurisdiction_id clause is added
 * here because some of these tables (audit_log) allow a null
 * jurisdiction_id for system-level rows that the RLS policy itself already
 * excludes correctly — duplicating that logic here would risk drifting
 * from the single source of truth in schema/core.sql. */
const EXPORT_TABLES: readonly string[] = [
  "jurisdictions",
  "users",
  "structures",
  "assessments",
  "assessment_elements",
  "photos",
  "calculations",
  "determinations",
  "letters",
  "audit_log",
];

export async function getFullExportTables(jurisdictionId: string, userId: string | null): Promise<ExportTable[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const tables: ExportTable[] = [];
    for (const tableName of EXPORT_TABLES) {
      const { rows, fields } = await client.query(`select * from ${tableName} order by 1`);
      const columns = fields.map((f) => f.name);
      tables.push({ tableName, columns, rows });
    }
    return tables;
  });
}
