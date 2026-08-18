// Mutations for src/core/admin (T-W5): the ONLY code paths anywhere that
// INSERT a cost_tables row through a real UI (previously nothing did —
// only test harnesses seeded cost_tables directly), and a parallel,
// fuller-featured path to jurisdictions.ordinance_citation +
// letterhead_config (task instructions: "reuse/refactor-in-place the
// existing endpoint if sensible, otherwise a parallel admin endpoint" —
// this is the parallel endpoint; src/modules/a1-letters/actions.ts's
// setOrdinanceCitation is left completely untouched, so app/letters keeps
// working with zero changes, verified by re-running its own e2e gate).
//
// Every mutation here writes an audit_log row (AGENTS.md "data / backend
// agents" rule 2: "Every mutation of a determination writes to audit_log"
// — applied here to the two other legally-consequential inputs this
// codebase has: the cost table an SD ratio is computed from, and the
// ordinance authority a letter cites).
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import {
  isValidAppealWindowDays,
  isValidEffectiveDateIso,
  isValidSourceCitation,
  parseCostTablePayload,
} from "./pure";
import type {
  InsertCostTableInput,
  InsertCostTableResult,
  UpdateJurisdictionSettingsInput,
  UpdateJurisdictionSettingsResult,
} from "./types";

interface PgUniqueViolationError {
  code: string;
}

function isUniqueViolation(err: unknown): err is PgUniqueViolationError {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

/**
 * Loads a new cost table. Validates BEFORE ever touching the database:
 * a version label, a source citation that clears the min-length placeholder
 * guard, a valid effective date, and a payload containing every one of the
 * 12 residential + 7 non-residential SDE element codes as a finite
 * non-negative number — nothing else. Cost tables are versioned history
 * (schema/core.sql comment: "json_payload rows must each carry
 * source_citation + page; the app refuses a table whose entries lack
 * citations") — this INSERTs a new row, never touches an existing one
 * (AGENTS.md rule 10's insert-only discipline extends here by the same
 * reasoning: a calculation stamps cost_table_version and must stay
 * reproducible against the exact row it used).
 */
export async function insertCostTable(
  jurisdictionId: string,
  userId: string,
  input: InsertCostTableInput,
): Promise<InsertCostTableResult> {
  const version = input.version.trim();
  if (version.length === 0) {
    return { ok: false, error: "version_required" };
  }
  const citation = input.sourceCitation.trim();
  if (citation.length === 0) {
    return { ok: false, error: "citation_required" };
  }
  if (!isValidSourceCitation(citation)) {
    return { ok: false, error: "citation_too_short" };
  }
  if (!isValidEffectiveDateIso(input.effectiveDateIso)) {
    return { ok: false, error: "effective_date_invalid" };
  }
  const parsed = parseCostTablePayload(input.payload);
  if (!parsed.ok || !parsed.value) {
    return { ok: false, error: "payload_invalid", fieldErrors: parsed.fieldErrors };
  }

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    try {
      await client.query(
        `insert into cost_tables (version, jurisdiction_id, source_citation, effective_date, json_payload)
         values ($1, $2, $3, $4, $5)`,
        [
          version,
          jurisdictionId,
          citation,
          input.effectiveDateIso,
          JSON.stringify({ base_cost_per_sqft: parsed.value }),
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { ok: false, error: "version_exists" };
      }
      throw err;
    }

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'cost_table', null, 'insert', null, $3)`,
      [
        userId,
        jurisdictionId,
        JSON.stringify({
          version,
          source_citation: citation,
          effective_date: input.effectiveDateIso,
        }),
      ],
    );

    return { ok: true, version };
  });
}

/**
 * Writes jurisdictions.ordinance_citation + the letterhead_config sub-keys
 * this screen owns (appeal_window_days, letterhead_name, address_lines,
 * icc_text). Unlike src/modules/a1-letters/actions.ts's
 * setOrdinanceCitation (which only ever ADDS a key, never removes one),
 * this admin screen supports genuine clearing: an explicit null/empty
 * input for a given field DELETES that key from letterhead_config, per
 * task instructions ("empty = unset = appeal_deadline_date stays null").
 * Full before/after audit on every call, whether or not anything actually
 * changed value-for-value — the write itself is the auditable event.
 */
export async function updateJurisdictionSettings(
  jurisdictionId: string,
  userId: string,
  input: UpdateJurisdictionSettingsInput,
): Promise<UpdateJurisdictionSettingsResult> {
  const citation = input.ordinanceCitation.trim();
  if (citation.length === 0) {
    return { ok: false, error: "citation_required" };
  }
  if (input.appealWindowDays !== null && !isValidAppealWindowDays(input.appealWindowDays)) {
    return { ok: false, error: "invalid_appeal_window" };
  }

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const beforeRes = await client.query(
      `select ordinance_citation, letterhead_config from jurisdictions where id = $1`,
      [jurisdictionId],
    );
    if (beforeRes.rows.length === 0) return { ok: false, error: "not_found" };
    const before = beforeRes.rows[0] as { ordinance_citation: string | null; letterhead_config: unknown };

    const existingConfig: Record<string, unknown> =
      typeof before.letterhead_config === "object" && before.letterhead_config !== null
        ? { ...(before.letterhead_config as Record<string, unknown>) }
        : {};

    const nextConfig = { ...existingConfig };

    if (input.appealWindowDays === null) {
      delete nextConfig.appeal_window_days;
    } else {
      nextConfig.appeal_window_days = input.appealWindowDays;
    }

    const letterheadName = input.letterheadName?.trim() ?? "";
    if (letterheadName.length === 0) {
      delete nextConfig.letterhead_name;
    } else {
      nextConfig.letterhead_name = letterheadName;
    }

    const addressLines = (input.addressLines ?? []).map((l) => l.trim()).filter((l) => l.length > 0);
    if (addressLines.length === 0) {
      delete nextConfig.address_lines;
    } else {
      nextConfig.address_lines = addressLines;
    }

    const iccText = input.iccText?.trim() ?? "";
    if (iccText.length === 0) {
      delete nextConfig.icc_text;
    } else {
      nextConfig.icc_text = iccText;
    }

    const updatedRes = await client.query(
      `update jurisdictions
       set ordinance_citation = $1,
           letterhead_config = $2::jsonb
       where id = $3
       returning ordinance_citation, letterhead_config`,
      [citation, JSON.stringify(nextConfig), jurisdictionId],
    );
    const after = updatedRes.rows[0] as { ordinance_citation: string | null; letterhead_config: unknown };

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'jurisdiction', $3, 'admin_update_settings', $4, $5)`,
      [userId, jurisdictionId, jurisdictionId, JSON.stringify(before), JSON.stringify(after)],
    );

    return { ok: true };
  });
}
