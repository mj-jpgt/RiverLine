import { describe, expect, it } from "vitest";
import {
  buildEnrichmentSuggestions,
  mapOccupancyType,
  parseStories,
  pickSqFt,
} from "../../../src/core/registry/hamco-source";
import type { HamcoParcelRecord } from "../../../src/core/registry/hamco-source";

// F1 registry task: enrichment ("Refresh from county records"). Every
// assertion here traces to docs/data-contracts/dlgf-property-classes.md and
// docs/data-contracts/hamilton-county-parcels.md's documented gaps — no
// invented field semantics (AGENTS.md rule 4).

describe("mapOccupancyType (mirrors scripts/preprocess/ingest-parcels.mjs)", () => {
  it("maps the residential DLGF range 499-599", () => {
    expect(mapOccupancyType("511")).toBe("residential");
    expect(mapOccupancyType("499")).toBe("residential");
    expect(mapOccupancyType("599")).toBe("residential");
  });

  it("maps documented non-residential ranges", () => {
    expect(mapOccupancyType("100")).toBe("non_residential");
    expect(mapOccupancyType("425")).toBe("non_residential");
    expect(mapOccupancyType("300")).toBe("non_residential");
    expect(mapOccupancyType("699")).toBe("non_residential");
  });

  it("leaves the ambiguous commercial-apartment codes 400/401/402 NULL, never guessed", () => {
    expect(mapOccupancyType("400")).toBeNull();
    expect(mapOccupancyType("401")).toBeNull();
    expect(mapOccupancyType("402")).toBeNull();
  });

  it("leaves null/unparseable/out-of-range PROPCLASS NULL", () => {
    expect(mapOccupancyType(null)).toBeNull();
    expect(mapOccupancyType("")).toBeNull();
    expect(mapOccupancyType("not-a-code")).toBeNull();
    expect(mapOccupancyType("999")).toBeNull();
  });
});

describe("parseStories", () => {
  it("trims and parses the trailing-space string format (hamilton-county-parcels.md Gap #3)", () => {
    expect(parseStories("1.0 ")).toBe(1);
    expect(parseStories("2.5")).toBe(3); // rounds
  });

  it("returns null for null/empty/unparseable input", () => {
    expect(parseStories(null)).toBeNull();
    expect(parseStories("")).toBeNull();
    expect(parseStories("n/a")).toBeNull();
  });
});

describe("pickSqFt", () => {
  it("prefers sq_ft_res for residential, falling back to sq_ft_comm", () => {
    expect(pickSqFt("residential", 1500, 9000)).toBe(1500);
    expect(pickSqFt("residential", null, 9000)).toBe(9000);
  });

  it("prefers sq_ft_comm for non_residential, falling back to sq_ft_res", () => {
    expect(pickSqFt("non_residential", 1500, 9000)).toBe(9000);
    expect(pickSqFt("non_residential", 1500, null)).toBe(1500);
  });

  it("returns null when both are null", () => {
    expect(pickSqFt("residential", null, null)).toBeNull();
  });
});

describe("buildEnrichmentSuggestions", () => {
  const record: HamcoParcelRecord = {
    parcelNo: "1010010102010001",
    avImprove: 190700,
    propClass: "511",
    sqFtRes: 1576,
    sqFtComm: null,
    yearBuilt: 1983,
    numFloors: "1.0 ",
  };

  it("suggests a field only when the structure's current value is null (never overwrite)", () => {
    const suggestions = buildEnrichmentSuggestions(
      {
        improvementValue: null, // blank -> suggest
        sqFt: 1576, // already on file -> never suggest a change
        yearBuilt: null,
        stories: null,
        occupancyType: null,
        propClass: null,
      },
      record,
      "2026-08-18T12:00:00.000Z",
    );

    const fields = suggestions.map((s) => s.field);
    expect(fields).toContain("improvementValue");
    expect(fields).toContain("yearBuilt");
    expect(fields).toContain("stories");
    expect(fields).toContain("occupancyType");
    expect(fields).toContain("propClass");
    expect(fields).not.toContain("sqFt"); // already populated

    const improvement = suggestions.find((s) => s.field === "improvementValue");
    expect(improvement?.suggestedValue).toBe(190700);
    expect(improvement?.sourceLabel).toBe("County assessor record, fetched 2026-08-18");
    expect(improvement?.label).toBe("Improvement value");
  });

  it("suggests nothing when every tracked field is already on file", () => {
    const suggestions = buildEnrichmentSuggestions(
      {
        improvementValue: 190700,
        sqFt: 1576,
        yearBuilt: 1983,
        stories: 1,
        occupancyType: "residential",
        propClass: "511",
      },
      record,
      "2026-08-18T12:00:00.000Z",
    );
    expect(suggestions).toEqual([]);
  });

  it("suggests nothing for a field the source itself has no value for either", () => {
    const noSourceValue: HamcoParcelRecord = {
      parcelNo: "1010010000019000",
      avImprove: null, // real example: 16780 River Rd, "Ind. - Vacant land"
      propClass: "300",
      sqFtRes: null,
      sqFtComm: null,
      yearBuilt: null,
      numFloors: null,
    };
    const suggestions = buildEnrichmentSuggestions(
      {
        improvementValue: null,
        sqFt: null,
        yearBuilt: null,
        stories: null,
        occupancyType: null,
        propClass: null,
      },
      noSourceValue,
      "2026-08-18T12:00:00.000Z",
    );
    // propClass itself is the one field the source DOES have — everything
    // else is genuinely absent upstream, not an ingest gap.
    expect(suggestions.map((s) => s.field)).toEqual(["occupancyType", "propClass"]);
  });
});
