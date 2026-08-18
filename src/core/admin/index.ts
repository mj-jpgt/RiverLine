// Public entry point for src/core/admin — the only path app/ (or any other
// core family) may import through, per eslint-plugin-boundaries
// (docs/adr/0003-module-boundary-enforcement.md).
//
// Why src/core/admin rather than src/shared/admin (the task's other
// offered option): this module holds real business logic and SQL — cost-
// table validation rules, the ACTIVE-cost-table selection tie-break,
// jurisdiction-settings read/merge/audit — the same shape as
// src/core/determination and src/core/registry (domain queries + mutations
// behind an index.ts), not a dependency-free presentational/utility leaf
// like src/shared/ui or src/shared/db. src/shared/** in this codebase
// never imports src/core/* (it is a leaf under the boundary rules) and has
// no precedent for holding tenant-scoped SQL; putting DB queries there
// would be the first exception to that pattern. See
// docs/journal/2026-08-17-w5-admin.md for the fuller justification.
export { getCostTables, getActiveCostTableVersion, getJurisdictionSettings, getReadinessStatus } from "./queries";
export { insertCostTable, updateJurisdictionSettings } from "./actions";
export {
  RESIDENTIAL_CODES,
  NON_RESIDENTIAL_CODES,
  MIN_SOURCE_CITATION_LENGTH,
  isNonEmptyText,
  isValidSourceCitation,
  isValidAppealWindowDays,
  isValidEffectiveDateIso,
  parseCostTablePayload,
  costTablePayloadSchema,
} from "./pure";
export type {
  CostTableListRow,
  CostTablePayload,
  InsertCostTableInput,
  InsertCostTableResult,
  JurisdictionSettings,
  UpdateJurisdictionSettingsInput,
  UpdateJurisdictionSettingsResult,
  ReadinessStatus,
} from "./types";
