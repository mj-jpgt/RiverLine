import { describe, expect, it } from "vitest";
import { runEngine } from "@/core/engine";
import type { EngineCostTable, EngineInput, Occupancy } from "@/core/engine";
import costTableFixture from "../../fixtures/engine/cost-table.test-fixture-v0.json";
import casesFixture from "../../fixtures/engine/cases.json";

// Runs every case in test/fixtures/engine/cases.json verbatim. This file
// never modifies, extends, or regenerates that fixture directory
// (test/fixtures/engine/README.md, SUBAGENT.md test-agent rule 2) — it only
// loads and asserts against it.

const costTable: EngineCostTable = {
  version: costTableFixture.version,
  base_cost_per_sqft: costTableFixture.base_cost_per_sqft as EngineCostTable["base_cost_per_sqft"],
};

interface SuccessCase {
  id: string;
  occupancy: Occupancy;
  sq_ft: number;
  market_value_used: number;
  damage: Record<string, number>;
  expected: { total_repair_cost: number; ratio: number; threshold_result: "SD" | "NOT_SD" | "BORDERLINE" };
  working: string;
}

interface ErrorCase {
  id: string;
  occupancy: Occupancy;
  sq_ft: number;
  market_value_used: number;
  damage: Record<string, number>;
  expected_error: string;
}

type Case = SuccessCase | ErrorCase;

const cases = casesFixture.cases as Case[];

function toInput(c: Case): EngineInput {
  return {
    occupancy: c.occupancy,
    sq_ft: c.sq_ft,
    market_value_used: c.market_value_used,
    damage: c.damage,
    cost_table: costTable,
  };
}

describe("50%-rule engine — golden fixtures (test/fixtures/engine/cases.json)", () => {
  const successCases = cases.filter((c): c is SuccessCase => !("expected_error" in c));
  const errorCases = cases.filter((c): c is ErrorCase => "expected_error" in c);

  // Sanity: every case in the fixture file is actually exercised below —
  // if the orchestrator adds a case, this test file must not silently skip it.
  it("covers every case id present in cases.json", () => {
    expect(successCases.length + errorCases.length).toBe(cases.length);
    expect(cases.map((c) => c.id)).toEqual([
      "G1-zero-damage",
      "G2-total-loss-res",
      "G3-partial-not-sd",
      "G4-borderline-mid",
      "G5-nonres-borderline",
      "G6-lower-boundary-exact-45",
      "G7-upper-boundary-exact-55-via-half-damage",
      "E1-invalid-market-value-zero",
      "E2-unknown-element-code",
      "E3-wrong-occupancy-element",
    ]);
  });

  for (const c of successCases) {
    it(`${c.id}: ${c.working}`, () => {
      const result = runEngine(toInput(c));
      expect(result.total_repair_cost).toBe(c.expected.total_repair_cost);
      expect(result.ratio).toBe(c.expected.ratio);
      expect(result.threshold_result).toBe(c.expected.threshold_result);
      expect(result.engine_version).toBe("1.0.0");
    });
  }

  for (const c of errorCases) {
    it(`${c.id}: throws "${c.expected_error}"`, () => {
      expect(() => runEngine(toInput(c))).toThrow(c.expected_error);
    });
  }
});
