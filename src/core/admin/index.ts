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
export {
  getCostTables,
  getActiveCostTableVersion,
  getJurisdictionSettings,
  getReadinessStatus,
  getTeamSummary,
  listUsers,
} from "./queries";
export {
  insertCostTable,
  updateJurisdictionSettings,
  createUser,
  deactivateUser,
  reactivateUser,
  changeUserRole,
  generateSignInLink,
} from "./actions";
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
  normalizeEmail,
  isValidEmail,
  isValidUserRole,
} from "./pure";
// ROLE_DESCRIPTIONS/ROLES/UserRole: defined once in src/shared/roles.ts
// (client-bundle-safe — see that file's comment) and re-exported here for
// server-side consumers (app/admin/users/page.tsx, src/core/admin's own
// actions.ts/queries.ts). "use client" components import
// @/shared/roles directly, never through this barrel, so adding a new
// pg-touching export here in the future cannot break their build again.
export { ROLE_DESCRIPTIONS, ROLES } from "@/shared/roles";
export type {
  CostTableListRow,
  CostTablePayload,
  InsertCostTableInput,
  InsertCostTableResult,
  JurisdictionSettings,
  UpdateJurisdictionSettingsInput,
  UpdateJurisdictionSettingsResult,
  ReadinessStatus,
  UserRole,
  UserListRow,
  TeamSummary,
  CreateUserInput,
  CreateUserResult,
  DeactivateUserResult,
  ReactivateUserResult,
  ChangeUserRoleInput,
  ChangeUserRoleResult,
  GenerateSignInLinkResult,
} from "./types";
