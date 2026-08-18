// Public types for src/core/admin (T-W5). This module gives a jurisdiction
// administrator the ONLY way, anywhere in this codebase, to load a real
// cost_tables row and to fill in jurisdictions.ordinance_citation /
// letterhead_config through a UI (previously: nothing wrote cost_tables at
// all outside test harnesses; the ordinance form existed only bolted onto
// app/letters, with no UI for letterhead name/address/ICC or a standalone
// readiness view). specs/constitution.md #2 is NOT being weakened here —
// the honest "no cost table loaded" / "ordinance citation missing" states
// stay exactly as M3/A1 built them; this module is the resolution path a
// real jurisdiction uses to clear them with its OWN sourced data.

/** One row from cost_tables, as listed for the admin cost-table screen. */
export interface CostTableListRow {
  version: string;
  /** null = a shared/global table (schema/core.sql: "null = shared/global
   * table"), not scoped to this jurisdiction specifically. */
  jurisdictionId: string | null;
  sourceCitation: string;
  effectiveDateIso: string;
  createdAtIso: string;
  /** True for exactly the one row app/calculation/_lib/compute.ts's
   * ACTIVE-cost-table query would select for this jurisdiction right now
   * (src/core/admin/queries.ts mirrors that exact SQL — see its comment).
   * At most one row in the list is ever active. */
  isActive: boolean;
}

/** The exact per-element dollar shape the engine consumes
 * (src/core/engine/types.ts EngineCostTable['base_cost_per_sqft']),
 * keyed by the verified SDE 3.0 element codes
 * (docs/data-contracts/sde-cost-tables.md / src/core/capture/elements.ts). */
export interface CostTablePayload {
  residential: Record<string, number>;
  non_residential: Record<string, number>;
}

export interface InsertCostTableInput {
  version: string;
  sourceCitation: string;
  effectiveDateIso: string;
  payload: CostTablePayload;
}

export type InsertCostTableResult =
  | { ok: true; version: string }
  | {
      ok: false;
      error: "version_required" | "citation_required" | "citation_too_short" | "effective_date_invalid" | "payload_invalid" | "version_exists";
      fieldErrors?: string[];
    };

/** jurisdictions.ordinance_citation + the letterhead_config sub-keys this
 * module reads/writes. Key names are shared with src/modules/a1-letters
 * (src/modules/a1-letters/queries.ts's readAppealWindowDays/readLetterheadName/
 * readLetterheadAddressLines/readIccText) — this module writes the SAME
 * jsonb keys through its OWN parallel endpoint (task instructions: "reuse...
 * if sensible, otherwise a parallel admin endpoint"), so app/letters keeps
 * reading correctly with zero changes to that module. */
export interface JurisdictionSettings {
  jurisdictionName: string;
  ordinanceCitation: string | null;
  appealWindowDays: number | null;
  letterheadName: string | null;
  addressLines: string[];
  iccText: string | null;
}

export interface UpdateJurisdictionSettingsInput {
  /** Required, non-empty (specs/constitution.md #2 / docs/BLOCKERS.md B2). */
  ordinanceCitation: string;
  /** null clears the value (task instructions: "empty = unset = appeal_deadline_date stays null"). */
  appealWindowDays: number | null;
  letterheadName: string | null;
  addressLines: string[] | null;
  iccText: string | null;
}

export type UpdateJurisdictionSettingsResult =
  | { ok: true }
  | { ok: false; error: "citation_required" | "invalid_appeal_window" | "not_found" };

/** The honest readiness panel (/admin): what is configured, what is not,
 * and what stays blocked while it's not. Never invents a status — each
 * field is read straight off the same tables/columns the real
 * calculation/letters code paths check. */
export interface ReadinessStatus {
  costTableLoaded: boolean;
  activeCostTableVersion: string | null;
  ordinanceCitationSet: boolean;
  appealWindowSet: boolean;
}
