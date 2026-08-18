// All tenant-scoped structure reads/writes for the registry module. Every
// function here goes through withTenant() (src/shared/db) — jurisdiction
// scoping is enforced by Postgres RLS (schema/core.sql), not by an
// application-level WHERE clause (docs/agents/SUBAGENT.md "Role: data /
// backend agents" #1: "Application-level filtering is not sufficient and
// will be rejected"). withTenant() sets app.jurisdiction_id via SET LOCAL
// ROLE riverline_app before every query in these functions, exactly as
// test/unit/db/rls.test.ts (T-C1) proves for other tables.
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { buildEnrichmentSuggestions, fetchCountyParcelRecord } from "./hamco-source";
import type {
  EnrichableField,
  EnrichmentAcceptedFields,
  EnrichmentResult,
  ManualStructureInput,
  OccupancyType,
  RegistryNearbyResult,
  RegistrySearchResult,
  RegistryStructureDetail,
} from "./types";

// Sentinel prefix written into structures.notes for hand-created records
// (the "Structure not found?" manual path, F1 registry task) — a fixed,
// grep-able marker rather than free-text sniffing, so isManualEntry
// detection below is exact, not a guess. See migrations/0006_structures_notes.sql
// for why `notes` (not a new value_source enum member) carries this.
const MANUAL_ENTRY_MARKER = "[UNVERIFIED MANUAL ENTRY]";
// PARCELNO in the source data is always a 16-digit numeric string
// (hamilton-county-parcels.md); this prefix can never collide with a real
// one, so it doubles as a visible "no county parcel number" signal in the UI.
const MANUAL_PARCEL_PREFIX = "MANUAL-";

function toOccupancyType(value: unknown): OccupancyType | null {
  return value === "residential" || value === "non_residential" ? value : null;
}

function isManualEntry(notes: unknown): boolean {
  return typeof notes === "string" && notes.startsWith(MANUAL_ENTRY_MARKER);
}

function toSearchResult(row: Record<string, unknown>): RegistrySearchResult {
  return {
    id: row.id as string,
    parcelId: row.parcel_id as string,
    address: row.address as string,
    occupancyType: toOccupancyType(row.occupancy_type),
    sfhaZone: (row.sfha_zone as string | null) ?? null,
    propClass: (row.prop_class as string | null) ?? null,
    improvementValue: row.improvement_value === null ? null : Number(row.improvement_value),
    isManualEntry: isManualEntry(row.notes),
  };
}

/** The `pg` driver parses Postgres `date`/`timestamptz` columns into JS
 * Date objects, not strings — TypeScript's `as string` casts elsewhere in
 * this file don't catch that at runtime. Format explicitly to an ISO date
 * string (YYYY-MM-DD) so a React component can render it directly. */
function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toDetail(row: Record<string, unknown>): RegistryStructureDetail {
  return {
    id: row.id as string,
    parcelId: row.parcel_id as string,
    address: row.address as string,
    assessorMarketValue:
      row.assessor_market_value === null ? null : Number(row.assessor_market_value),
    improvementValue: row.improvement_value === null ? null : Number(row.improvement_value),
    valueSource: row.value_source as string,
    valueAsOfDate: toIsoDate(row.value_as_of_date),
    sfhaZone: (row.sfha_zone as string | null) ?? null,
    firmPanel: (row.firm_panel as string | null) ?? null,
    occupancyType: toOccupancyType(row.occupancy_type),
    foundationType: (row.foundation_type as string | null) ?? null,
    stories: row.stories === null ? null : Number(row.stories),
    sqFt: row.sq_ft === null ? null : Number(row.sq_ft),
    yearBuilt: row.year_built === null ? null : Number(row.year_built),
    propClass: (row.prop_class as string | null) ?? null,
    createdAt: toIsoTimestamp(row.created_at),
    isManualEntry: isManualEntry(row.notes),
  };
}

/**
 * Address type-ahead. `query` is matched against LOCADDRESS-sourced
 * `structures.address` with a case-insensitive substring match. Returns at
 * most 20 rows, shortest/alphabetically-first address first so a partial
 * house-number match ("168") surfaces the closer matches before longer
 * unrelated ones.
 */
export async function searchStructuresByAddress(
  jurisdictionId: string,
  userId: string | null,
  query: string,
): Promise<RegistrySearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, parcel_id, address, occupancy_type, sfha_zone, prop_class, improvement_value, notes
       from structures
       where address ilike '%' || $1 || '%'
       order by length(address), address
       limit 20`,
      [trimmed],
    );
    return rows.map(toSearchResult);
  });
}

/**
 * Nearest 10 structures to a GPS point, by real distance (PostGIS
 * ST_Distance on the geography cast of the precomputed `geom` column — this
 * reads a stored geometry, it does not compute a spatial join at request
 * time; AGENTS.md "Geospatial" reserves joins/raster work for
 * scripts/preprocess/, not distance-to-a-point sorting of already-loaded
 * rows).
 */
export async function nearestStructures(
  jurisdictionId: string,
  userId: string | null,
  lat: number,
  lng: number,
  limit = 10,
): Promise<RegistryNearbyResult[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select id, parcel_id, address, occupancy_type, sfha_zone, prop_class, improvement_value, notes,
              ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance_m
       from structures
       where geom is not null
       order by distance_m asc
       limit $3`,
      [lng, lat, limit],
    );
    return rows.map((row) => ({
      ...toSearchResult(row),
      distanceMeters: Number(row.distance_m),
    }));
  });
}

export async function getStructureById(
  jurisdictionId: string,
  userId: string | null,
  structureId: string,
): Promise<RegistryStructureDetail | null> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query("select * from structures where id = $1", [structureId]);
    if (rows.length === 0) return null;
    return toDetail(rows[0]);
  });
}

/**
 * The assessor sets occupancy_type in the field when the parcel data left
 * it NULL (unknown/ambiguous PROPCLASS — scripts/preprocess/ingest-parcels.mjs
 * never guesses it). Only allowed while it is currently NULL — matches the
 * task's "editable if NULL" behavior; once set, this is the parcel's
 * occupancy of record and further correction is an explicit override
 * elsewhere, not silently re-editable here.
 */
export async function setOccupancyType(
  jurisdictionId: string,
  userId: string | null,
  structureId: string,
  occupancyType: OccupancyType,
): Promise<{ ok: true; structure: RegistryStructureDetail } | { ok: false; reason: "not_found" | "already_set" }> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `update structures set occupancy_type = $1
       where id = $2 and occupancy_type is null
       returning *`,
      [occupancyType, structureId],
    );
    if (rows.length > 0) {
      return { ok: true as const, structure: toDetail(rows[0]) };
    }
    const existing = await client.query("select id, occupancy_type from structures where id = $1", [
      structureId,
    ]);
    if (existing.rows.length === 0) return { ok: false as const, reason: "not_found" as const };
    return { ok: false as const, reason: "already_set" as const };
  });
}

// --- Enrichment (autofill from the county record) --------------------------

/**
 * Fetches the live county parcel record for this structure's PARCELNO and
 * returns editable suggestions for whichever tracked fields are currently
 * NULL. Read-only — no DB write. Never throws: a county-service failure
 * (network, timeout, parcel not found — see hamco-source.ts) comes back as
 * `{ available: false, suggestions: [] }`, the "degrade silently to manual
 * entry" behavior the task requires.
 */
export async function getEnrichmentSuggestions(
  jurisdictionId: string,
  userId: string | null,
  structureId: string,
): Promise<EnrichmentResult | { notFound: true }> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(
      `select parcel_id, improvement_value, sq_ft, year_built, stories, occupancy_type, prop_class
       from structures where id = $1`,
      [structureId],
    );
    if (rows.length === 0) return { notFound: true as const };
    const row = rows[0];

    const record = await fetchCountyParcelRecord(row.parcel_id as string);
    if (!record) {
      return { available: false, fetchedAt: null, suggestions: [] };
    }

    const fetchedAt = new Date().toISOString();
    const suggestions = buildEnrichmentSuggestions(
      {
        improvementValue: row.improvement_value === null ? null : Number(row.improvement_value),
        sqFt: row.sq_ft === null ? null : Number(row.sq_ft),
        yearBuilt: row.year_built === null ? null : Number(row.year_built),
        stories: row.stories === null ? null : Number(row.stories),
        occupancyType: toOccupancyType(row.occupancy_type),
        propClass: (row.prop_class as string | null) ?? null,
      },
      record,
      fetchedAt,
    );
    return { available: true, fetchedAt, suggestions };
  });
}

const ENRICHABLE_COLUMNS: Record<EnrichableField, string> = {
  improvementValue: "improvement_value",
  sqFt: "sq_ft",
  yearBuilt: "year_built",
  stories: "stories",
  occupancyType: "occupancy_type",
  propClass: "prop_class",
};

/**
 * Writes assessor-accepted enrichment suggestions. Each field is applied
 * only if the column is STILL null at write time (`column is null` guard in
 * the UPDATE) — defense in depth against a race with a manual edit that
 * happened between the suggestion being shown and being accepted; this is
 * the actual enforcement of "never overwrite an existing user-entered value
 * automatically." Every applied field gets its own audit_log row
 * (entity_type 'structure', action 'enrichment_accepted') carrying
 * before/after value + source + fetch date — this is the field-level
 * provenance record; structures itself has no free-form per-field
 * provenance column and none was added (AGENTS.md rule 1 — audit_log
 * already exists and is the schema-supported place for this).
 */
export async function applyEnrichment(
  jurisdictionId: string,
  userId: string | null,
  structureId: string,
  accepted: EnrichmentAcceptedFields,
  sourceLabel: string,
): Promise<{ ok: true; applied: EnrichableField[]; skipped: EnrichableField[]; structure: RegistryStructureDetail } | { ok: false; reason: "not_found" }> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const applied: EnrichableField[] = [];
    const skipped: EnrichableField[] = [];

    for (const [field, value] of Object.entries(accepted) as [EnrichableField, string | number][]) {
      const column = ENRICHABLE_COLUMNS[field];
      if (!column) continue;
      const { rows } = await client.query(
        `update structures set ${column} = $1
         where id = $2 and ${column} is null
         returning ${column}`,
        [value, structureId],
      );
      if (rows.length > 0) {
        applied.push(field);
        await client.query(
          `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
           values ($1, $2, 'structure', $3, 'enrichment_accepted', $4, $5)`,
          [
            userId,
            jurisdictionId,
            structureId,
            JSON.stringify({ field, value: null }),
            JSON.stringify({ field, value, source: sourceLabel }),
          ],
        );
      } else {
        skipped.push(field);
      }
    }

    const { rows: finalRows } = await client.query("select * from structures where id = $1", [structureId]);
    if (finalRows.length === 0) return { ok: false as const, reason: "not_found" as const };
    return { ok: true as const, applied, skipped, structure: toDetail(finalRows[0]) };
  });
}

// --- Manual structure creation ("Structure not found?" path) ---------------

/**
 * Hand-creates a structure row when the assessor cannot find the parcel in
 * the county ingest (coverage gap — see docs/journal/2026-08-18-f1-registry.md
 * "Coverage"). address is required; parcelId is optional (a synthetic
 * MANUAL-<random> id is generated when omitted, which can never collide
 * with a real 16-digit PARCELNO). Always flagged via the notes sentinel
 * (MANUAL_ENTRY_MARKER) so every surface that reads this row (search
 * results, detail page, future calc/review screens) can render it as
 * unverified. value_source is required NOT NULL by the frozen schema and
 * has no enum member for "no source yet, hand-entered" — 'official_override'
 * is the closest existing meaning ("a human, not an automated feed, is
 * asserting this record") and is reused here rather than inventing a new
 * enum value; documented as a judgment call in the journal, not a guess.
 */
export async function createManualStructure(
  jurisdictionId: string,
  userId: string | null,
  input: ManualStructureInput,
): Promise<RegistryStructureDetail> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const parcelId = input.parcelId?.trim() || `${MANUAL_PARCEL_PREFIX}${crypto.randomUUID().slice(0, 12)}`;
    const notes = `${MANUAL_ENTRY_MARKER} Created by field assessor; parcel not found in the county parcel registry. Address and any attributes are as reported by the assessor, not sourced from an authoritative record.`;

    const { rows } = await client.query(
      `insert into structures (
         jurisdiction_id, parcel_id, address, value_source, occupancy_type, notes
       ) values ($1, $2, $3, 'official_override', $4, $5)
       returning *`,
      [jurisdictionId, parcelId, input.address.trim(), input.occupancyType, notes],
    );

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'structure', $3, 'manual_create', null, $4)`,
      [userId, jurisdictionId, rows[0].id, JSON.stringify({ address: input.address, parcelId })],
    );

    return toDetail(rows[0]);
  });
}
