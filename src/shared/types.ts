/**
 * Cross-module interface contract.
 *
 * SOURCE OF TRUTH: `schema/core.sql` (frozen, human-authored). That file
 * does not exist yet as of this writing — this module is BLOCKED on it.
 * These types are a literal mirror of the table shapes described in
 * `docs/riverline-sdd-build-spec.md` §3 "Data Model", nothing more. Do not
 * add fields, computed properties, or convenience types here that are not
 * present in that table list. When `schema/core.sql` lands, regenerate
 * these types against it and delete this comment.
 *
 * Every field below traces to a column in build-spec §3. Nothing is invented.
 */

export type Uuid = string;
export type IsoTimestamp = string;
export type IsoDate = string;

export type UserRole = "admin" | "assessor" | "official" | "viewer";

export type ThresholdResult = "SD" | "NOT_SD" | "BORDERLINE";

export type DeterminationStatus =
  | "draft"
  | "adopted"
  | "contested"
  | "superseded";

export interface Jurisdiction {
  id: Uuid;
  name: string;
  nfip_cid: string;
  ordinance_citation: string;
  letterhead_config: unknown;
  created_at: IsoTimestamp;
}

export interface User {
  id: Uuid;
  email: string;
  jurisdiction_id: Uuid;
  role: UserRole;
  created_at: IsoTimestamp;
}

export interface Structure {
  id: Uuid;
  jurisdiction_id: Uuid;
  parcel_id: string;
  address: string;
  /** PostGIS geometry(Point). Shape intentionally left opaque here; server
   * code reads/writes it via PostGIS functions, not client-side geometry math. */
  geom: unknown;
  assessor_market_value: number;
  improvement_value: number;
  value_source: string;
  value_as_of_date: IsoDate;
  sfha_zone: string;
  firm_panel: string;
  occupancy_type: string;
  foundation_type: string;
  stories: number;
  created_at: IsoTimestamp;
}

export type SyncStatus = "pending" | "synced" | "conflict" | "error";

export interface Assessment {
  id: Uuid;
  structure_id: Uuid;
  assessor_user_id: Uuid;
  started_at: IsoTimestamp;
  completed_at: IsoTimestamp | null;
  sync_status: SyncStatus;
  device_captured_at: IsoTimestamp;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy_m: number | null;
  water_depth_interior_in: number | null;
  water_depth_source: string | null;
  notes: string | null;
}

export interface AssessmentElement {
  id: Uuid;
  assessment_id: Uuid;
  element_code: string;
  damage_pct: number;
  cost_table_version: string;
  computed_cost: number;
}

export interface Photo {
  id: Uuid;
  assessment_id: Uuid;
  storage_key: string;
  sha256: string;
  captured_at: IsoTimestamp;
  gps_lat: number | null;
  gps_lng: number | null;
  caption: string | null;
}

/**
 * Immutable. A re-run inserts a new row; never UPDATE (AGENTS.md rule 10).
 */
export interface Calculation {
  id: Uuid;
  assessment_id: Uuid;
  cost_table_version: string;
  total_repair_cost: number;
  market_value_used: number;
  value_source: string;
  ratio: number;
  threshold_result: ThresholdResult;
  computed_at: IsoTimestamp;
  engine_version: string;
}

/**
 * Never deleted. Status becomes "superseded" (AGENTS.md rule 11). Never
 * auto-adopted in code or copy — adoption is a human, recorded action.
 */
export interface Determination {
  id: Uuid;
  structure_id: Uuid;
  calculation_id: Uuid;
  status: DeterminationStatus;
  adopted_by_user_id: Uuid | null;
  adopted_at: IsoTimestamp | null;
  letter_id: Uuid | null;
  appeal_deadline_date: IsoDate | null;
  notes: string | null;
}

export interface Letter {
  id: Uuid;
  determination_id: Uuid;
  template_version: string;
  pdf_storage_key: string;
  issued_at: IsoTimestamp;
  delivery_method: string;
}

export interface AuditLogEntry {
  id: Uuid;
  actor_user_id: Uuid;
  entity_type: string;
  entity_id: Uuid;
  action: string;
  before_json: unknown;
  after_json: unknown;
  at: IsoTimestamp;
}

export interface CostTable {
  version: string;
  source_citation: string;
  effective_date: IsoDate;
  json_payload: unknown;
}
