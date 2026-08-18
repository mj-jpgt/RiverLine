// Read-only queries for src/core/admin. Every query is jurisdiction-scoped
// through withTenant() (RLS-enforced) — same pattern every other module's
// queries.ts already establishes (src/core/determination/queries.ts,
// src/modules/a1-letters/queries.ts).
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { isNonEmptyText, isValidAppealWindowDays } from "./pure";
import type { CostTableListRow, JurisdictionSettings, ReadinessStatus } from "./types";

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The ACTIVE cost table for a jurisdiction, matching
 * app/calculation/_lib/compute.ts's selection query EXACTLY: prefer a
 * jurisdiction-scoped row over a shared/global one (jurisdiction_id is
 * null), then the most recently effective within that preference. There is
 * no separate "active" flag in schema/core.sql (frozen), so this IS the
 * explicit rule — compute.ts's own comment already states it; this module
 * does not change compute.ts, it mirrors its SQL so the admin list's
 * "ACTIVE" badge always agrees with what a real calculation would actually
 * use. If that selection query ever changes, this one must change with it.
 */
async function queryActiveCostTableVersion(client: PoolClient, jurisdictionId: string): Promise<string | null> {
  const res = await client.query(
    `select version
     from cost_tables
     where jurisdiction_id = $1 or jurisdiction_id is null
     order by (jurisdiction_id is not null) desc, effective_date desc
     limit 1`,
    [jurisdictionId],
  );
  return res.rows.length > 0 ? (res.rows[0].version as string) : null;
}

/** Every cost table visible to this jurisdiction (its own rows + shared/
 * global rows), newest-effective first, with the ACTIVE one flagged. */
export async function getCostTables(jurisdictionId: string, userId: string | null): Promise<CostTableListRow[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const activeVersion = await queryActiveCostTableVersion(client, jurisdictionId);
    const res = await client.query(
      `select version, jurisdiction_id, source_citation, effective_date, created_at
       from cost_tables
       where jurisdiction_id = $1 or jurisdiction_id is null
       order by effective_date desc, created_at desc`,
      [jurisdictionId],
    );
    return res.rows.map((row) => ({
      version: row.version as string,
      jurisdictionId: (row.jurisdiction_id as string | null) ?? null,
      sourceCitation: row.source_citation as string,
      effectiveDateIso: toIsoDate(row.effective_date),
      createdAtIso: toIso(row.created_at),
      isActive: row.version === activeVersion,
    }));
  });
}

export async function getActiveCostTableVersion(jurisdictionId: string, userId: string | null): Promise<string | null> {
  return withTenant(jurisdictionId, userId, (client: PoolClient) => queryActiveCostTableVersion(client, jurisdictionId));
}

function readAppealWindowDays(letterheadConfig: unknown): number | null {
  if (typeof letterheadConfig !== "object" || letterheadConfig === null) return null;
  const value = (letterheadConfig as Record<string, unknown>).appeal_window_days;
  return typeof value === "number" && isValidAppealWindowDays(value) ? value : null;
}

function readLetterheadName(letterheadConfig: unknown): string | null {
  if (typeof letterheadConfig !== "object" || letterheadConfig === null) return null;
  const value = (letterheadConfig as Record<string, unknown>).letterhead_name;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readAddressLines(letterheadConfig: unknown): string[] {
  if (typeof letterheadConfig !== "object" || letterheadConfig === null) return [];
  const value = (letterheadConfig as Record<string, unknown>).address_lines;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function readIccText(letterheadConfig: unknown): string | null {
  if (typeof letterheadConfig !== "object" || letterheadConfig === null) return null;
  const value = (letterheadConfig as Record<string, unknown>).icc_text;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** jurisdictions.ordinance_citation + the letterhead_config sub-keys this
 * screen edits. Reads the SAME keys src/modules/a1-letters/queries.ts reads
 * (readAppealWindowDays/readLetterheadName/readLetterheadAddressLines/
 * readIccText there) — reimplemented here as tiny pure readers rather than
 * imported, because core families may not import a modules family
 * (docs/adr/0003-module-boundary-enforcement.md). */
export async function getJurisdictionSettings(
  jurisdictionId: string,
  userId: string | null,
): Promise<JurisdictionSettings | null> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const res = await client.query(`select name, ordinance_citation, letterhead_config from jurisdictions where id = $1`, [
      jurisdictionId,
    ]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0] as { name: string; ordinance_citation: string | null; letterhead_config: unknown };
    return {
      jurisdictionName: row.name,
      ordinanceCitation: row.ordinance_citation,
      appealWindowDays: readAppealWindowDays(row.letterhead_config),
      letterheadName: readLetterheadName(row.letterhead_config),
      addressLines: readAddressLines(row.letterhead_config),
      iccText: readIccText(row.letterhead_config),
    };
  });
}

/** The honest readiness panel (/admin). Reads the exact same signals the
 * real calculation (app/calculation/_lib/compute.ts) and letters
 * (src/modules/a1-letters) code paths check — never a separately-tracked
 * "setup complete" flag that could drift from reality. */
export async function getReadinessStatus(jurisdictionId: string, userId: string | null): Promise<ReadinessStatus> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const activeVersion = await queryActiveCostTableVersion(client, jurisdictionId);
    const jurRes = await client.query(`select ordinance_citation, letterhead_config from jurisdictions where id = $1`, [
      jurisdictionId,
    ]);
    const jur = jurRes.rows[0] as { ordinance_citation: string | null; letterhead_config: unknown } | undefined;
    return {
      costTableLoaded: activeVersion !== null,
      activeCostTableVersion: activeVersion,
      ordinanceCitationSet: isNonEmptyText(jur?.ordinance_citation ?? null),
      appealWindowSet: readAppealWindowDays(jur?.letterhead_config) !== null,
    };
  });
}
