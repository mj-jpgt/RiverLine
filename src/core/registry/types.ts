// Registry-local view of `structures`. Deliberately NOT importing
// src/shared/types.ts's `Structure` — that interface predates
// schema/core.sql landing (see its own file comment) and is missing
// several columns this module needs (sq_ft, year_built, prop_class).
// Editing src/shared/types.ts is outside this task's module directory
// (specs/core/tasks.md T-C2: "May read ... src/shared/types.ts" is not
// even listed — registry's allowed module is src/core/registry/ + app/
// registry routes only), so this file defines its own narrow, accurate
// mirror of the columns the registry UI actually reads/writes, traced
// directly to schema/core.sql's `structures` table.

export type OccupancyType = "residential" | "non_residential";

export interface RegistrySearchResult {
  id: string;
  parcelId: string;
  address: string;
  occupancyType: OccupancyType | null;
  sfhaZone: string | null;
}

export interface RegistryNearbyResult extends RegistrySearchResult {
  distanceMeters: number;
}

export interface RegistryStructureDetail {
  id: string;
  parcelId: string;
  address: string;
  assessorMarketValue: number | null;
  improvementValue: number | null;
  valueSource: string;
  valueAsOfDate: string | null;
  sfhaZone: string | null;
  firmPanel: string | null;
  occupancyType: OccupancyType | null;
  foundationType: string | null;
  stories: number | null;
  sqFt: number | null;
  yearBuilt: number | null;
  propClass: string | null;
  createdAt: string;
}
