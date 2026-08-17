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
import type {
  OccupancyType,
  RegistryNearbyResult,
  RegistrySearchResult,
  RegistryStructureDetail,
} from "./types";

function toOccupancyType(value: unknown): OccupancyType | null {
  return value === "residential" || value === "non_residential" ? value : null;
}

function toSearchResult(row: Record<string, unknown>): RegistrySearchResult {
  return {
    id: row.id as string,
    parcelId: row.parcel_id as string,
    address: row.address as string,
    occupancyType: toOccupancyType(row.occupancy_type),
    sfhaZone: (row.sfha_zone as string | null) ?? null,
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
      `select id, parcel_id, address, occupancy_type, sfha_zone
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
      `select id, parcel_id, address, occupancy_type, sfha_zone,
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
