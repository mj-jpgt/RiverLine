// Public entry point for src/core/registry — the only path app/ (or any
// other core family) may import through, per eslint-plugin-boundaries
// (docs/adr/0003-module-boundary-enforcement.md).
export {
  searchStructuresByAddress,
  nearestStructures,
  getStructureById,
  setOccupancyType,
  getEnrichmentSuggestions,
  applyEnrichment,
  createManualStructure,
} from "./queries";
export type {
  OccupancyType,
  RegistrySearchResult,
  RegistryNearbyResult,
  RegistryStructureDetail,
  EnrichableField,
  EnrichmentSuggestion,
  EnrichmentResult,
  EnrichmentAcceptedFields,
  ManualStructureInput,
} from "./types";
