// The 50%-rule calculation engine. Pure, deterministic, zero I/O (build
// spec §5). Implemented to test/fixtures/engine/README.md and cases.json —
// orchestrator-authored golden fixtures this module may never modify
// (SUBAGENT.md test-agent rule 2).
//
// Semantics (verbatim from the README, restated here only as code, not
// re-decided):
//   element repair cost = base_cost_per_sqft[element_code] × sq_ft × (damage_pct/100)
//   total_repair_cost = Σ element repair costs (elements absent from input = 0%)
//   ratio = total_repair_cost / market_value_used, rounded half-up to 4 dp
//   threshold_result: ratio < 0.45 -> NOT_SD; 0.45 <= ratio < 0.55 -> BORDERLINE;
//     ratio >= 0.55 -> SD (routing bands only; legal threshold stays 50% in
//     all user-facing copy; BORDERLINE forces official review)
//   market_value_used <= 0 -> error, no calculation row
//   Depreciation (FEMA P-784 Table 3-5) is NOT applied in v1 (README).
//
// Element-code validity is derived from the cost_table input itself
// (cost_table.base_cost_per_sqft[occupancy]'s key set) rather than a
// hardcoded list duplicated from src/core/capture/elements.ts — the pure
// engine takes the cost table as its only source of "what elements exist
// for this occupancy" per its documented input contract (structure,
// elements, cost_table) -> ..., and this is exactly what makes E2/E3 in
// cases.json (an unrelated code, and a code valid for the *other*
// occupancy) both resolve to the one "unknown element code for occupancy"
// error without engine.ts needing to know the SDE table shape at all.

import { ratioBasisPoints } from "./rounding";
import type { EngineElementResult, EngineInput, EngineOutput, ThresholdResult } from "./types";

export const ENGINE_VERSION = "1.0.0";

const NOT_SD_UPPER_BASIS_POINTS = 4500n; // 0.45, lower boundary of BORDERLINE (inclusive)
const SD_LOWER_BASIS_POINTS = 5500n; // 0.55, lower boundary of SD (inclusive)

function classify(basisPoints: bigint): ThresholdResult {
  if (basisPoints >= SD_LOWER_BASIS_POINTS) return "SD";
  if (basisPoints >= NOT_SD_UPPER_BASIS_POINTS) return "BORDERLINE";
  return "NOT_SD";
}

/**
 * Runs the 50%-rule calculation. Throws on invalid input — never returns a
 * partial/fabricated result. Callers (persistence wiring, outside this
 * module) must not insert a `calculations` row when this throws.
 */
export function runEngine(input: EngineInput): EngineOutput {
  const { occupancy, sq_ft, market_value_used, damage, cost_table } = input;

  if (!(market_value_used > 0)) {
    throw new Error("market_value_used must be > 0");
  }

  const occupancyCosts = cost_table.base_cost_per_sqft[occupancy];
  if (!occupancyCosts || Object.keys(occupancyCosts).length === 0) {
    throw new Error(`unknown occupancy: ${occupancy}`);
  }

  // Validate every damaged element code exists in the cost table for this
  // occupancy BEFORE computing anything — a partial computation followed
  // by a thrown error would be a worse failure mode than failing fast.
  for (const code of Object.keys(damage)) {
    if (!(code in occupancyCosts)) {
      throw new Error("unknown element code for occupancy");
    }
  }

  const elements: EngineElementResult[] = [];
  let totalRepairCost = 0;

  // Full per-element breakdown for the occupancy, in cost_table key order
  // — undamaged/unmentioned elements are included at 0%, per README
  // ("elements absent from input = 0%"), so the display table (task
  // requirement 3) always shows every element, not just the damaged ones.
  for (const [elementCode, baseCost] of Object.entries(occupancyCosts)) {
    const damagePct = damage[elementCode] ?? 0;
    const computedCost = (baseCost * sq_ft * damagePct) / 100;
    elements.push({ element_code: elementCode, base_cost: baseCost, computed_cost: computedCost });
    totalRepairCost += computedCost;
  }

  const basisPoints = ratioBasisPoints(totalRepairCost, market_value_used);
  const ratio = Number(basisPoints) / 10000;
  const threshold_result = classify(basisPoints);

  return {
    elements,
    total_repair_cost: totalRepairCost,
    ratio,
    threshold_result,
    engine_version: ENGINE_VERSION,
  };
}
