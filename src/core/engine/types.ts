// Public types for the 50%-rule calculation engine (M3).
//
// Semantics are fixed by test/fixtures/engine/README.md (orchestrator-
// authored, never modified by agents — SUBAGENT.md test-agent rule 2).
// This file only declares shapes; all arithmetic lives in calculate.ts.

/** Occupancy branch. Determines which element-code set (and therefore
 * which key set of cost_table.base_cost_per_sqft) is valid. */
export type Occupancy = "residential" | "non_residential";

/**
 * Shape of a cost_tables.json_payload row (schema/core.sql). The engine
 * takes this as plain input — it never reads cost_tables from a database
 * itself (zero I/O, build spec §5). Every dollar figure in the real
 * production cost table must carry a source_citation (schema/core.sql
 * comment, AGENTS.md rule 5); this module never invents one and never
 * hardcodes a dollar value.
 */
export interface EngineCostTable {
  version: string;
  base_cost_per_sqft: {
    residential: Record<string, number>;
    non_residential: Record<string, number>;
  };
}

/** Pure input to the engine. No database row, no request object — a plain
 * value the caller (persistence wiring, outside this module) assembles
 * from structures/assessment_elements/cost_tables rows. */
export interface EngineInput {
  occupancy: Occupancy;
  sq_ft: number;
  market_value_used: number;
  /** element_code -> damage percentage (0-100). Element codes absent from
   * this map are treated as 0% damage (README: "elements absent from
   * input = 0%"). */
  damage: Record<string, number>;
  cost_table: EngineCostTable;
}

export type ThresholdResult = "NOT_SD" | "BORDERLINE" | "SD";

export interface EngineElementResult {
  element_code: string;
  /** $/sqft rate from cost_table for this element_code + occupancy. */
  base_cost: number;
  /** base_cost * sq_ft * (damage_pct / 100). */
  computed_cost: number;
}

export interface EngineOutput {
  /** One row per valid element_code for the occupancy (the full SDE
   * breakdown, per cost_table's own key set) — undamaged elements appear
   * with computed_cost 0, not omitted, so the per-element display table
   * (task requirement) always shows the complete structure. */
  elements: EngineElementResult[];
  total_repair_cost: number;
  /** total_repair_cost / market_value_used, rounded half-up to 4 dp. */
  ratio: number;
  threshold_result: ThresholdResult;
  engine_version: string;
}
