// Mutations for the A1 letters module: issuing a letter (letters row +
// archived HTML + audit + determinations.letter_id link) and the admin
// ordinance-citation/letterhead form (jurisdictions.ordinance_citation +
// letterhead_config.appeal_window_days, audited). Unlike T-C5's
// determination module, these mutations need no OTHER core family's
// persistence helper, so — unlike app/determination/_lib/actions.ts — they
// live inside this module (src/modules/a1-letters/), same as its
// queries/pure files; app/letters/ route handlers call straight into them.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { getStorageDriver } from "@/shared/storage";
import { getLetterPreview } from "./queries";
import { isNonEmptyOrdinanceCitation, isValidAppealWindowDays, renderLetterHtml, TEMPLATE_VERSION } from "./pure";
import type { IssueLetterResult, SetOrdinanceResult } from "./types";

/**
 * Issues a letter for an adopted, definite (SD/NOT_SD) determination whose
 * jurisdiction has a real ordinance citation on file. Re-validates the full
 * state server-side (never trusts a UI that rendered "ready" a moment ago —
 * the citation could have raced, though nothing in this codebase currently
 * un-sets one). Writes the archived HTML through src/shared/storage's
 * StorageDriver under letters/<jurisdictionId>/<letterId>.html, INSERTs the
 * immutable `letters` row, links determinations.letter_id, and audits the
 * issue — mirrors the "override -> audit -> new row" discipline T-C5
 * established.
 */
export async function issueLetter(
  jurisdictionId: string,
  userId: string,
  clientId: string,
): Promise<IssueLetterResult> {
  const preview = await getLetterPreview(jurisdictionId, userId, clientId);

  if (preview.status === "issued") return { ok: false, error: "already_issued" };
  if (preview.status !== "ready") return { ok: false, error: "not_ready" };

  const letterId = randomUUID();
  const storageKey = `letters/${jurisdictionId}/${letterId}.html`;
  const html = renderLetterHtml(preview.facts, { issued: true });

  await getStorageDriver().put(storageKey, Buffer.from(html, "utf8"), "text/html");

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    await client.query(
      `insert into letters (id, determination_id, jurisdiction_id, template_version, pdf_storage_key, issued_at)
       values ($1, $2, $3, $4, $5, now())`,
      [letterId, preview.determinationId, jurisdictionId, TEMPLATE_VERSION, storageKey],
    );

    await client.query(`update determinations set letter_id = $1 where id = $2`, [letterId, preview.determinationId]);

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'letter', $3, 'issue', null, $4)`,
      [
        userId,
        jurisdictionId,
        letterId,
        JSON.stringify({
          determination_id: preview.determinationId,
          template_version: TEMPLATE_VERSION,
          pdf_storage_key: storageKey,
        }),
      ],
    );

    return { ok: true, letterId, storageKey };
  });
}

export interface SetOrdinanceInput {
  ordinanceCitation: string;
  appealWindowDays: number | null;
  letterheadName: string | null;
  letterheadAddressLines: string[] | null;
}

/**
 * Admin-only path to fill in the two known data gaps this module refuses on
 * (specs/constitution.md #2): jurisdictions.ordinance_citation and
 * letterhead_config.appeal_window_days. Role guard lives in the caller
 * (app/letters/[clientId]/ordinance/route.ts), same split as every other
 * mutation route in this codebase. Audited: before/after on the
 * jurisdiction row.
 */
export async function setOrdinanceCitation(
  jurisdictionId: string,
  userId: string,
  input: SetOrdinanceInput,
): Promise<SetOrdinanceResult> {
  if (!isNonEmptyOrdinanceCitation(input.ordinanceCitation)) {
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

    const configPatch: Record<string, unknown> = {};
    if (input.appealWindowDays !== null) configPatch.appeal_window_days = input.appealWindowDays;
    if (input.letterheadName !== null) configPatch.letterhead_name = input.letterheadName;
    if (input.letterheadAddressLines !== null) configPatch.address_lines = input.letterheadAddressLines;

    const updatedRes = await client.query(
      `update jurisdictions
       set ordinance_citation = $1,
           letterhead_config = coalesce(letterhead_config, '{}'::jsonb) || $2::jsonb
       where id = $3
       returning ordinance_citation, letterhead_config`,
      [input.ordinanceCitation.trim(), JSON.stringify(configPatch), jurisdictionId],
    );
    const after = updatedRes.rows[0] as { ordinance_citation: string | null; letterhead_config: unknown };

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'jurisdiction', $3, 'set_ordinance_and_letterhead', $4, $5)`,
      [userId, jurisdictionId, jurisdictionId, JSON.stringify(before), JSON.stringify(after)],
    );

    return { ok: true };
  });
}
