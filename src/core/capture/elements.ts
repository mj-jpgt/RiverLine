// SDE 3.0 element list — verbatim from docs/data-contracts/sde-cost-tables.md
// (FEMA P-784, Tables 3-6 / 3-8), which is itself the source of truth per
// specs/constitution.md §3: "the build spec §4.3's 8-item list is corrected
// and must not be used." Do not add/remove/rename an element here without a
// corresponding update to the data contract — never invent an element name.
//
// `code` values match the keys used in test/fixtures/engine/cost-table.test-fixture-v0.json
// (the canonical element_code strings referenced by docs/journal/2026-08-17-c2-registry.md's
// mandatory-reading list) and are what gets written to
// assessment_elements.element_code (schema/core.sql).

export interface ElementDefinition {
  code: string;
  /** Verbatim FEMA P-784 element name (Table 3-6 / 3-8 "Element" column). */
  name: string;
}

// Residential — 12 elements, Table 3-6 (PDF p.65-67, printed pages 3-39/3-41).
export const RESIDENTIAL_ELEMENTS: readonly ElementDefinition[] = [
  { code: "foundations", name: "Foundations" },
  { code: "superstructure", name: "Superstructure" },
  { code: "roof_covering", name: "Roof covering" },
  { code: "exterior_finish", name: "Exterior finish" },
  { code: "interior_finish", name: "Interior finish" },
  { code: "doors_windows", name: "Doors and windows" },
  { code: "cabinets_countertops", name: "Cabinets and countertops" },
  { code: "floor_finish", name: "Floor finish" },
  { code: "plumbing", name: "Plumbing" },
  { code: "electrical", name: "Electrical" },
  { code: "appliances", name: "Appliances" },
  { code: "hvac", name: "HVAC" },
];

// Non-residential — 7 elements, Table 3-8 (PDF p.77, printed page 3-51).
export const NON_RESIDENTIAL_ELEMENTS: readonly ElementDefinition[] = [
  { code: "foundations", name: "Foundations" },
  { code: "superstructure", name: "Superstructure" },
  { code: "roof_covering", name: "Roof covering" },
  { code: "plumbing", name: "Plumbing" },
  { code: "electrical", name: "Electrical" },
  { code: "interiors", name: "Interiors" },
  { code: "hvac", name: "HVAC" },
];

export type Occupancy = "residential" | "non_residential";

export function elementsForOccupancy(occupancy: Occupancy): readonly ElementDefinition[] {
  return occupancy === "residential" ? RESIDENTIAL_ELEMENTS : NON_RESIDENTIAL_ELEMENTS;
}
