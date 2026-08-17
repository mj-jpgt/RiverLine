// Mutation logic for the M4 official review workflow: overrides, adopt,
// supersede. Deliberately outside src/core/determination/ (which is
// read-only queries + pure helpers) because every mutation here needs to
// re-run the M3 engine and INSERT a new immutable calculations row — that
// persistence helper (computeAndPersistCalculation) lives in
// app/calculation/_lib/compute.ts, and src/core/<family> may only import a
// DIFFERENT core family through its own index.ts (eslint-plugin-boundaries,
// docs/adr/0003) — never through app/. app-to-app imports are unrestricted
// (both files match the single "app" boundary element), so this app/-level
// file is the correct home for logic that needs both
// src/core/determination and app/calculation/_lib together. Same pattern
// T-C4 already used for app/calculation/_lib/compute.ts itself.
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { computeAndPersistCalculation, type ComputeResult } from "../../calculation/_lib/compute";
import { computeAppealDeadlineDate, readAppealWindowDays } from "@/core/determination";

export type ActionError =
  | "reason_required"
  | "invalid_damage_pct"
  | "invalid_value"
  | "invalid_value_source"
  | "not_found"
  | "no_calculation"
  | "already_adopted"
  | "confirmation_required"
  | "not_adopted"
  | "compute_failed";

export interface OverrideResult {
  ok: boolean;
  error?: ActionError;
  compute?: ComputeResult;
}

function nonEmptyReason(reason: string | null | undefined): reason is string {
  return typeof reason === "string" && reason.trim().length > 0;
}

/**
 * Official overrides one element's damage %. Audited (before/after +
 * reason), then re-runs the engine — INSERTS a new immutable calculations
 * row; the prior row is untouched and remains queryable (AGENTS.md rule 10).
 * Reason is mandatory: an empty/missing reason is rejected before any write
 * happens (task instructions "Empty reason = blocked").
 */
export async function overrideElementDamage(
  jurisdictionId: string,
  userId: string,
  clientId: string,
  elementCode: string,
  newDamagePct: number,
  reason: string,
): Promise<OverrideResult> {
  if (!nonEmptyReason(reason)) return { ok: false, error: "reason_required" };
  if (!Number.isInteger(newDamagePct) || newDamagePct < 0 || newDamagePct > 100) {
    return { ok: false, error: "invalid_damage_pct" };
  }

  const updateResult = await withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(`select id from assessments where client_id = $1`, [clientId]);
    if (assessmentRes.rows.length === 0) return { ok: false as const, error: "not_found" as const };
    const assessmentId = assessmentRes.rows[0].id as string;

    const elementRes = await client.query(
      `select id, damage_pct from assessment_elements where assessment_id = $1 and element_code = $2`,
      [assessmentId, elementCode],
    );
    if (elementRes.rows.length === 0) return { ok: false as const, error: "not_found" as const };
    const elementId = elementRes.rows[0].id as string;
    const before = Number(elementRes.rows[0].damage_pct);

    if (before === newDamagePct) {
      // No-op change: still requires a valid reason to reach here, but
      // nothing to override — skip the write/audit noise.
      return { ok: true as const, assessmentId, changed: false };
    }

    await client.query(`update assessment_elements set damage_pct = $1 where id = $2`, [newDamagePct, elementId]);

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'assessment_element', $3, 'override_damage_pct', $4, $5)`,
      [
        userId,
        jurisdictionId,
        elementId,
        JSON.stringify({ element_code: elementCode, damage_pct: before }),
        JSON.stringify({ element_code: elementCode, damage_pct: newDamagePct, reason: reason.trim() }),
      ],
    );

    return { ok: true as const, assessmentId, changed: true };
  });

  if (!updateResult.ok) return { ok: false, error: updateResult.error };

  const compute = await computeAndPersistCalculation(jurisdictionId, userId, clientId);
  if (compute.status !== "ok") return { ok: false, error: "compute_failed", compute };
  return { ok: true, compute };
}

/**
 * Official sets the market value directly (e.g. from an independent
 * appraisal). `valueSource` must be one of the two override-appropriate
 * values already present in schema/core.sql's structures.value_source
 * CHECK constraint. Audited, then re-runs the engine (new calculations
 * row), same as overrideElementDamage.
 */
export async function overrideMarketValue(
  jurisdictionId: string,
  userId: string,
  clientId: string,
  newValue: number,
  valueSource: "official_override" | "appraisal",
  reason: string,
): Promise<OverrideResult> {
  if (!nonEmptyReason(reason)) return { ok: false, error: "reason_required" };
  if (!Number.isFinite(newValue) || newValue <= 0) return { ok: false, error: "invalid_value" };
  if (valueSource !== "official_override" && valueSource !== "appraisal") {
    return { ok: false, error: "invalid_value_source" };
  }

  const updateResult = await withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(
      `select a.structure_id from assessments a where a.client_id = $1`,
      [clientId],
    );
    if (assessmentRes.rows.length === 0) return { ok: false as const, error: "not_found" as const };
    const structureId = assessmentRes.rows[0].structure_id as string;

    const structureRes = await client.query(
      `select assessor_market_value, value_source from structures where id = $1`,
      [structureId],
    );
    if (structureRes.rows.length === 0) return { ok: false as const, error: "not_found" as const };
    const before = {
      assessor_market_value:
        structureRes.rows[0].assessor_market_value === null ? null : Number(structureRes.rows[0].assessor_market_value),
      value_source: structureRes.rows[0].value_source as string,
    };

    await client.query(`update structures set assessor_market_value = $1, value_source = $2 where id = $3`, [
      newValue,
      valueSource,
      structureId,
    ]);

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'structure', $3, 'override_market_value', $4, $5)`,
      [
        userId,
        jurisdictionId,
        structureId,
        JSON.stringify(before),
        JSON.stringify({ assessor_market_value: newValue, value_source: valueSource, reason: reason.trim() }),
      ],
    );

    return { ok: true as const };
  });

  if (!updateResult.ok) return { ok: false, error: updateResult.error };

  const compute = await computeAndPersistCalculation(jurisdictionId, userId, clientId);
  if (compute.status !== "ok") return { ok: false, error: "compute_failed", compute };
  return { ok: true, compute };
}

export interface AdoptResult {
  ok: boolean;
  error?: ActionError;
  determinationId?: string;
  appealDeadlineDate?: string | null;
  appealWindowConfigured?: boolean;
}

/**
 * Explicit adoption. Never called automatically anywhere in this codebase
 * (AGENTS.md rule 12) — the caller (app/api/determination/[clientId]/adopt/route.ts)
 * requires `confirmed: true` in the request body, which only a UI
 * confirmation dialog step sends. appeal_deadline_date is computed from the
 * jurisdiction's configured appeal_window_days if present; if not
 * configured, it is left NULL rather than inventing a number — the caller
 * surfaces the docs/BLOCKERS.md B2 state explicitly.
 */
export async function adoptDetermination(
  jurisdictionId: string,
  userId: string,
  clientId: string,
  confirmed: boolean,
): Promise<AdoptResult> {
  if (!confirmed) return { ok: false, error: "confirmation_required" };

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(
      `select id, structure_id from assessments where client_id = $1`,
      [clientId],
    );
    if (assessmentRes.rows.length === 0) return { ok: false, error: "not_found" };
    const assessmentId = assessmentRes.rows[0].id as string;
    const structureId = assessmentRes.rows[0].structure_id as string;

    const calcRes = await client.query(
      `select id from calculations where assessment_id = $1 order by computed_at desc limit 1`,
      [assessmentId],
    );
    if (calcRes.rows.length === 0) return { ok: false, error: "no_calculation" };
    const calculationId = calcRes.rows[0].id as string;

    const existingRes = await client.query(
      `select d.id, d.status from determinations d
       join calculations c on c.id = d.calculation_id
       where c.assessment_id = $1
       order by d.created_at desc
       limit 1`,
      [assessmentId],
    );
    const existing = existingRes.rows[0] as { id: string; status: string } | undefined;
    if (existing && existing.status === "adopted") {
      return { ok: false, error: "already_adopted" };
    }

    const jurisdictionRes = await client.query(`select letterhead_config from jurisdictions where id = $1`, [
      jurisdictionId,
    ]);
    const appealWindowDays = readAppealWindowDays(jurisdictionRes.rows[0]?.letterhead_config ?? null);
    const adoptedAtIso = new Date().toISOString();
    const appealDeadlineDate = computeAppealDeadlineDate(adoptedAtIso, appealWindowDays);

    let determinationId: string;
    if (existing && existing.status === "draft") {
      await client.query(
        `update determinations
         set calculation_id = $1, status = 'adopted', adopted_by_user_id = $2, adopted_at = $3, appeal_deadline_date = $4
         where id = $5`,
        [calculationId, userId, adoptedAtIso, appealDeadlineDate, existing.id],
      );
      determinationId = existing.id;
    } else {
      const inserted = await client.query(
        `insert into determinations (
           structure_id, jurisdiction_id, calculation_id, status, adopted_by_user_id, adopted_at, appeal_deadline_date
         ) values ($1, $2, $3, 'adopted', $4, $5, $6)
         returning id`,
        [structureId, jurisdictionId, calculationId, userId, adoptedAtIso, appealDeadlineDate],
      );
      determinationId = inserted.rows[0].id as string;
    }

    return {
      ok: true,
      determinationId,
      appealDeadlineDate,
      appealWindowConfigured: appealWindowDays !== null,
    };
  });
}

export interface SupersedeResult {
  ok: boolean;
  error?: ActionError;
  newDeterminationId?: string;
  newClientId?: string;
}

/**
 * Supersede an adopted determination: recomputes a FRESH calculation for
 * the same assessment, creates a new `draft` determination pointing at it,
 * and flips the old row to `status = 'superseded'` — never deleted
 * (AGENTS.md rule 11; schema/core.sql's forbid_delete trigger would reject
 * a DELETE outright regardless). The UPDATE itself is audited automatically
 * by schema/core.sql's determinations_audit trigger; reason is additionally
 * required here and recorded on the new draft row's notes, matching the
 * override actions' "reason mandatory, audited" pattern for this
 * legally-consequential a reversal of an adopted determination.
 */
export async function supersedeDetermination(
  jurisdictionId: string,
  userId: string,
  determinationId: string,
  reason: string,
): Promise<SupersedeResult> {
  if (!nonEmptyReason(reason)) return { ok: false, error: "reason_required" };

  const lookup = await withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const res = await client.query(
      `select d.id, d.status, d.structure_id, c.assessment_id, a.client_id
       from determinations d
       join calculations c on c.id = d.calculation_id
       join assessments a on a.id = c.assessment_id
       where d.id = $1`,
      [determinationId],
    );
    if (res.rows.length === 0) return null;
    return res.rows[0] as { id: string; status: string; structure_id: string; assessment_id: string; client_id: string };
  });

  if (!lookup) return { ok: false, error: "not_found" };
  if (lookup.status !== "adopted" && lookup.status !== "contested") {
    return { ok: false, error: "not_adopted" };
  }

  const compute = await computeAndPersistCalculation(jurisdictionId, userId, lookup.client_id);
  if (compute.status !== "ok") return { ok: false, error: "compute_failed" };
  const newCalculationId = compute.calculation.id;

  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const inserted = await client.query(
      `insert into determinations (structure_id, jurisdiction_id, calculation_id, status, notes)
       values ($1, $2, $3, 'draft', $4)
       returning id`,
      [
        lookup.structure_id,
        jurisdictionId,
        newCalculationId,
        `Supersedes determination ${lookup.id}. Reason: ${reason.trim()}`,
      ],
    );
    const newDeterminationId = inserted.rows[0].id as string;

    await client.query(`update determinations set status = 'superseded' where id = $1`, [lookup.id]);

    return { ok: true, newDeterminationId, newClientId: lookup.client_id };
  });
}
