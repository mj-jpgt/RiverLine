import { describe, expect, it } from "vitest";
import {
  RESIDENTIAL_ELEMENTS,
  NON_RESIDENTIAL_ELEMENTS,
  elementsForOccupancy,
} from "@/core/capture/elements";
import costTableFixture from "../../fixtures/engine/cost-table.test-fixture-v0.json";

// Element codes must match docs/data-contracts/sde-cost-tables.md's verified
// 12-residential/7-non-residential set exactly — the same set the M3 engine
// fixture (test/fixtures/engine/cost-table.test-fixture-v0.json) already
// encodes. Cross-checking against that fixture is the test that would fail
// if capture's element list ever drifted from the engine's.
describe("capture element list", () => {
  it("has 12 residential elements matching the SDE data contract order", () => {
    expect(RESIDENTIAL_ELEMENTS).toHaveLength(12);
    expect(RESIDENTIAL_ELEMENTS.map((e) => e.code)).toEqual(
      Object.keys(costTableFixture.base_cost_per_sqft.residential),
    );
  });

  it("has 7 non-residential elements matching the SDE data contract order", () => {
    expect(NON_RESIDENTIAL_ELEMENTS).toHaveLength(7);
    expect(NON_RESIDENTIAL_ELEMENTS.map((e) => e.code)).toEqual(
      Object.keys(costTableFixture.base_cost_per_sqft.non_residential),
    );
  });

  it("every element has a non-empty verbatim name", () => {
    for (const e of [...RESIDENTIAL_ELEMENTS, ...NON_RESIDENTIAL_ELEMENTS]) {
      expect(e.name.length).toBeGreaterThan(0);
    }
  });

  it("elementsForOccupancy dispatches correctly", () => {
    expect(elementsForOccupancy("residential")).toBe(RESIDENTIAL_ELEMENTS);
    expect(elementsForOccupancy("non_residential")).toBe(NON_RESIDENTIAL_ELEMENTS);
  });
});
