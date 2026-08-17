import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, runEngine } from "@/core/engine";
import type { EngineCostTable, EngineInput } from "@/core/engine";
import costTableFixture from "../../fixtures/engine/cost-table.test-fixture-v0.json";

// Agent-authored edge-case tests, in addition to (never replacing) the
// golden fixtures in test/fixtures/engine/ (test/unit/engine/golden.test.ts).
// Per T-C4's brief: rounding edges, damage 0, missing elements treated as 0%.

const fixtureCostTable: EngineCostTable = {
  version: costTableFixture.version,
  base_cost_per_sqft: costTableFixture.base_cost_per_sqft as EngineCostTable["base_cost_per_sqft"],
};

// A minimal synthetic cost table (distinct from the fixture) to construct
// exact half-up tie cases the orchestrator's golden cases don't happen to
// hit. Only used in this file, never crosses into src/ or a seed path
// (AGENTS.md rule 6 — this stays inside test/).
const tieCostTable: EngineCostTable = {
  version: "EDGE-CASE-SYNTHETIC-v0",
  base_cost_per_sqft: {
    residential: { foundations: 12345 },
    non_residential: {},
  },
};

describe("engine edge cases", () => {
  it("damage 0% for every element -> total_repair_cost 0, ratio 0, NOT_SD", () => {
    const input: EngineInput = {
      occupancy: "residential",
      sq_ft: 1500,
      market_value_used: 250000,
      damage: {
        foundations: 0,
        superstructure: 0,
        roof_covering: 0,
        exterior_finish: 0,
        interior_finish: 0,
        doors_windows: 0,
        cabinets_countertops: 0,
        floor_finish: 0,
        plumbing: 0,
        electrical: 0,
        appliances: 0,
        hvac: 0,
      },
      cost_table: fixtureCostTable,
    };
    const result = runEngine(input);
    expect(result.total_repair_cost).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.threshold_result).toBe("NOT_SD");
    expect(result.elements.every((e) => e.computed_cost === 0)).toBe(true);
  });

  it("elements missing from the damage map are treated as 0% (not omitted from the breakdown)", () => {
    const input: EngineInput = {
      occupancy: "non_residential",
      sq_ft: 1000,
      market_value_used: 500000,
      damage: { superstructure: 20 }, // only one of the 7 non-res elements mentioned
      cost_table: fixtureCostTable,
    };
    const result = runEngine(input);
    // Full 7-element breakdown, even though only one was mentioned.
    expect(result.elements).toHaveLength(7);
    const superstructure = result.elements.find((e) => e.element_code === "superstructure")!;
    expect(superstructure.base_cost).toBe(25); // fixture non_residential.superstructure
    expect(superstructure.computed_cost).toBe(25 * 1000 * 0.2);
    const untouched = result.elements.filter((e) => e.element_code !== "superstructure");
    expect(untouched.every((e) => e.computed_cost === 0)).toBe(true);
    expect(result.total_repair_cost).toBe(5000);
  });

  it("engine_version is stamped as the ENGINE_VERSION constant", () => {
    const result = runEngine({
      occupancy: "residential",
      sq_ft: 100,
      market_value_used: 10000,
      damage: {},
      cost_table: fixtureCostTable,
    });
    expect(result.engine_version).toBe(ENGINE_VERSION);
    expect(ENGINE_VERSION).toBe("1.0.0");
  });

  it("a genuine half-up rounding tie at 4dp resolves via the exact BigInt path, not float Math.round", () => {
    // base_cost 12345 x sq_ft 1 x damage 100% = 12345; market 100000 ->
    // 12345/100000 = 0.12345 exactly, a true tie at the 4th decimal.
    const result = runEngine({
      occupancy: "residential",
      sq_ft: 1,
      market_value_used: 100000,
      damage: { foundations: 100 },
      cost_table: tieCostTable,
    });
    expect(result.total_repair_cost).toBe(12345);
    expect(result.ratio).toBe(0.1235);
  });

  it("market_value_used <= 0 throws and never returns a partial result", () => {
    expect(() =>
      runEngine({
        occupancy: "residential",
        sq_ft: 1000,
        market_value_used: -1,
        damage: {},
        cost_table: fixtureCostTable,
      }),
    ).toThrow("market_value_used must be > 0");
  });

  it("throws for an unknown occupancy value the cost table has no key set for", () => {
    const emptyOccupancyTable: EngineCostTable = {
      version: "x",
      base_cost_per_sqft: { residential: {}, non_residential: { foundations: 12 } },
    };
    expect(() =>
      runEngine({
        occupancy: "residential",
        sq_ft: 1000,
        market_value_used: 100000,
        damage: {},
        cost_table: emptyOccupancyTable,
      }),
    ).toThrow(/unknown occupancy/);
  });

  it("is a pure function: identical input produces identical output, no shared mutable state across calls", () => {
    const input: EngineInput = {
      occupancy: "residential",
      sq_ft: 1000,
      market_value_used: 100000,
      damage: { foundations: 50 },
      cost_table: fixtureCostTable,
    };
    const a = runEngine(input);
    const b = runEngine(input);
    expect(a).toEqual(b);
    // The input object itself is never mutated by the engine.
    expect(input.damage).toEqual({ foundations: 50 });
  });
});
