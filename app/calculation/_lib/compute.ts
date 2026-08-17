// Persistence wiring for the M3 engine (T-C4). This file is deliberately
// OUTSIDE src/core/engine/ — that module is pure, zero I/O (build spec §5).
// Everything here is the "thin" glue task instructions describe: read
// assessment/structure/cost_table rows, call the pure engine, insert an
// immutable calculations row.
//
// Shared by both the calculation page (app/calculation/[clientId]/page.tsx
// — auto-computes on first view if no row exists yet) and the manual
// "Recompute" trigger (app/api/calculation/compute/route.ts). Both are
// "app" boundary files per eslint-plugin-boundaries, so importing this
// helper from either is unrestricted.
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { ENGINE_VERSION, runEngine } from "@/core/engine";
import type { EngineCostTable, EngineOutput, Occupancy } from "@/core/engine";

export interface StructureValueInfo {
  id: string;
  address: string;
  occupancyType: Occupancy | null;
  sqFt: number | null;
  assessorMarketValue: number | null;
  improvementValue: number | null;
  valueSource: string;
}

export interface CalculationRow {
  id: string;
  assessmentId: string;
  costTableVersion: string;
  totalRepairCost: number;
  marketValueUsed: number;
  valueSource: string;
  ratio: number;
  thresholdResult: "SD" | "NOT_SD" | "BORDERLINE";
  computedAt: string;
  engineVersion: string;
}

export interface CostTableInfo {
  version: string;
  sourceCitation: string;
  effectiveDate: string;
}

/** Common "here is a fully computed calculation to render" payload, used
 * whether it was just inserted or is being re-displayed from a prior
 * insert. `elements` is always reconstructed by re-running the pure engine
 * against the EXACT cost_table_version stamped on the calculation row
 * (never the currently-active one, which may have since changed) — a
 * contested determination must be reproducible exactly (docs/agents/SUBAGENT.md
 * "Role: data / backend agents" #4). This costs one extra read, never a
 * write, and never touches assessment_elements. */
export interface CalculationView {
  calculation: CalculationRow;
  elements: EngineOutput["elements"];
  structure: StructureValueInfo;
  costTable: CostTableInfo;
  priorCalculationCount: number;
}

export type ComputeResult =
  | { status: "no_assessment" }
  /** structure.occupancy_type or structure.sq_ft is missing — the engine's
   * inputs are incomplete. Real, honest state (sq_ft is not a required
   * field to complete capture — src/core/capture/draft.ts's
   * canAdvanceFromStep only requires occupancyType), not a fabricated
   * placeholder. */
  | { status: "structure_incomplete"; structure: StructureValueInfo }
  /** specs/constitution.md §2 / docs/BLOCKERS.md B1: no cost table loaded
   * for this jurisdiction. Explicit runtime state, never a fabricated
   * figure. */
  | { status: "no_cost_table"; structure: StructureValueInfo }
  /** Neither assessor_market_value nor improvement_value is set —
   * "no value available — official must set value" per task instructions. */
  | { status: "no_value"; structure: StructureValueInfo }
  | ({ status: "ok" } & CalculationView);

export type ViewResult =
  | { status: "no_assessment" }
  | { status: "structure_incomplete"; structure: StructureValueInfo }
  | { status: "no_calculation_yet"; structure: StructureValueInfo }
  | ({ status: "has_calculation" } & CalculationView);

function toStructureValueInfo(row: Record<string, unknown>): StructureValueInfo {
  return {
    id: row.s_id as string,
    address: row.address as string,
    occupancyType:
      row.occupancy_type === "residential" || row.occupancy_type === "non_residential"
        ? (row.occupancy_type as Occupancy)
        : null,
    sqFt: row.sq_ft === null ? null : Number(row.sq_ft),
    assessorMarketValue: row.assessor_market_value === null ? null : Number(row.assessor_market_value),
    improvementValue: row.improvement_value === null ? null : Number(row.improvement_value),
    valueSource: row.value_source as string,
  };
}

function toCalculationRow(row: Record<string, unknown>): CalculationRow {
  return {
    id: row.id as string,
    assessmentId: row.assessment_id as string,
    costTableVersion: row.cost_table_version as string,
    totalRepairCost: Number(row.total_repair_cost),
    marketValueUsed: Number(row.market_value_used),
    valueSource: row.value_source as string,
    ratio: Number(row.ratio),
    thresholdResult: row.threshold_result as "SD" | "NOT_SD" | "BORDERLINE",
    computedAt: row.computed_at instanceof Date ? row.computed_at.toISOString() : String(row.computed_at),
    engineVersion: row.engine_version as string,
  };
}

function toCostTableInfo(row: Record<string, unknown>): CostTableInfo {
  return {
    version: row.version as string,
    sourceCitation: row.source_citation as string,
    effectiveDate:
      row.effective_date instanceof Date ? row.effective_date.toISOString().slice(0, 10) : String(row.effective_date),
  };
}

function toEngineCostTable(row: Record<string, unknown>): EngineCostTable {
  return {
    version: row.version as string,
    base_cost_per_sqft: (row.json_payload as { base_cost_per_sqft: EngineCostTable["base_cost_per_sqft"] })
      .base_cost_per_sqft,
  };
}

async function loadDamageMap(client: PoolClient, assessmentId: string): Promise<Record<string, number>> {
  const res = await client.query(`select element_code, damage_pct from assessment_elements where assessment_id = $1`, [
    assessmentId,
  ]);
  const damage: Record<string, number> = {};
  for (const el of res.rows) {
    damage[el.element_code as string] = Number(el.damage_pct);
  }
  return damage;
}

/**
 * Runs (or re-runs) the 50%-rule engine for one assessment and, on success,
 * INSERTs a new immutable `calculations` row (AGENTS.md rule 10 — never
 * UPDATE; a re-run is always a new row, both remain queryable). Returns an
 * explicit, typed state instead of computing/inserting when an input is
 * genuinely missing — never a fabricated figure (specs/constitution.md §2).
 */
export async function computeAndPersistCalculation(
  jurisdictionId: string,
  userId: string | null,
  clientId: string,
): Promise<ComputeResult> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(
      `select a.id as assessment_id,
              s.id as s_id, s.address, s.occupancy_type, s.sq_ft,
              s.assessor_market_value, s.improvement_value, s.value_source
       from assessments a
       join structures s on s.id = a.structure_id
       where a.client_id = $1`,
      [clientId],
    );
    if (assessmentRes.rows.length === 0) {
      return { status: "no_assessment" };
    }
    const row = assessmentRes.rows[0];
    const assessmentId = row.assessment_id as string;
    const structure = toStructureValueInfo(row);

    if (structure.occupancyType === null || structure.sqFt === null) {
      return { status: "structure_incomplete", structure };
    }

    // ACTIVE cost table for the jurisdiction: prefer a jurisdiction-scoped
    // row over a shared/global one (jurisdiction_id is null), then the most
    // recently effective within that preference — there is no separate
    // "active" flag in schema/core.sql, so "active" is read as "the
    // current one in force," i.e. latest effective_date.
    const costTableRes = await client.query(
      `select version, source_citation, effective_date, json_payload
       from cost_tables
       where jurisdiction_id = $1 or jurisdiction_id is null
       order by (jurisdiction_id is not null) desc, effective_date desc
       limit 1`,
      [jurisdictionId],
    );
    if (costTableRes.rows.length === 0) {
      return { status: "no_cost_table", structure };
    }
    const costTableRow = costTableRes.rows[0];
    const costTable = toEngineCostTable(costTableRow);

    const marketValueUsed = structure.assessorMarketValue ?? structure.improvementValue;
    if (marketValueUsed === null || !(marketValueUsed > 0)) {
      return { status: "no_value", structure };
    }
    const valueSource = structure.valueSource;

    const damage = await loadDamageMap(client, assessmentId);

    const engineResult = runEngine({
      occupancy: structure.occupancyType,
      sq_ft: structure.sqFt,
      market_value_used: marketValueUsed,
      damage,
      cost_table: costTable,
    });

    const inserted = await client.query(
      `insert into calculations (
         assessment_id, jurisdiction_id, cost_table_version, total_repair_cost,
         market_value_used, value_source, ratio, threshold_result, engine_version
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [
        assessmentId,
        jurisdictionId,
        costTable.version,
        engineResult.total_repair_cost,
        marketValueUsed,
        valueSource,
        engineResult.ratio,
        engineResult.threshold_result,
        ENGINE_VERSION,
      ],
    );

    const priorCountRes = await client.query(`select count(*)::int as n from calculations where assessment_id = $1`, [
      assessmentId,
    ]);

    return {
      status: "ok",
      calculation: toCalculationRow(inserted.rows[0]),
      elements: engineResult.elements,
      structure,
      costTable: toCostTableInfo(costTableRow),
      priorCalculationCount: (priorCountRes.rows[0].n as number) - 1,
    };
  });
}

/** Read-only: the most recent calculation for an assessment, if any,
 * reconstructed for display by re-running the pure engine against the
 * EXACT historical cost_table_version it was originally computed with
 * (reproducibility — see CalculationView doc comment above), never against
 * whatever cost table happens to be active now. Never inserts a row. */
export async function getLatestCalculationView(
  jurisdictionId: string,
  userId: string | null,
  clientId: string,
): Promise<ViewResult> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(
      `select a.id as assessment_id,
              s.id as s_id, s.address, s.occupancy_type, s.sq_ft,
              s.assessor_market_value, s.improvement_value, s.value_source
       from assessments a
       join structures s on s.id = a.structure_id
       where a.client_id = $1`,
      [clientId],
    );
    if (assessmentRes.rows.length === 0) return { status: "no_assessment" };
    const row = assessmentRes.rows[0];
    const structure = toStructureValueInfo(row);
    if (structure.occupancyType === null || structure.sqFt === null) {
      return { status: "structure_incomplete", structure };
    }
    const assessmentId = row.assessment_id as string;

    const calcRes = await client.query(
      `select * from calculations where assessment_id = $1 order by computed_at desc limit 1`,
      [assessmentId],
    );
    if (calcRes.rows.length === 0) {
      return { status: "no_calculation_yet", structure };
    }
    const calculation = toCalculationRow(calcRes.rows[0]);

    const costTableRes = await client.query(
      `select version, source_citation, effective_date, json_payload from cost_tables where version = $1`,
      [calculation.costTableVersion],
    );
    if (costTableRes.rows.length === 0) {
      // The stamped cost_table_version has since been removed — cannot
      // reconstruct the per-element breakdown honestly. Surface the
      // totals we do have (they are immutable and already correct) but
      // without a fabricated breakdown.
      const countRes = await client.query(`select count(*)::int as n from calculations where assessment_id = $1`, [
        assessmentId,
      ]);
      return {
        status: "has_calculation",
        calculation,
        elements: [],
        structure,
        costTable: { version: calculation.costTableVersion, sourceCitation: "Cost table version no longer on file.", effectiveDate: "" },
        priorCalculationCount: (countRes.rows[0].n as number) - 1,
      };
    }
    const costTableRow = costTableRes.rows[0];
    const costTable = toEngineCostTable(costTableRow);
    const damage = await loadDamageMap(client, assessmentId);

    const engineResult = runEngine({
      occupancy: structure.occupancyType,
      sq_ft: structure.sqFt,
      market_value_used: calculation.marketValueUsed,
      damage,
      cost_table: costTable,
    });

    const countRes = await client.query(`select count(*)::int as n from calculations where assessment_id = $1`, [
      assessmentId,
    ]);

    return {
      status: "has_calculation",
      calculation,
      elements: engineResult.elements,
      structure,
      costTable: toCostTableInfo(costTableRow),
      priorCalculationCount: (countRes.rows[0].n as number) - 1,
    };
  });
}
