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
import { issueSignInLinkForUser } from "@/core/auth";
import {
  isValidAppealWindowDays,
  isValidEffectiveDateIso,
  isValidSourceCitation,
  isValidEmail,
  isValidUserRole,
  normalizeEmail,
  parseCostTablePayload,
} from "./pure";
import type {
  ChangeUserRoleInput,
  ChangeUserRoleResult,
  CreateUserInput,
  CreateUserResult,
  DeactivateUserResult,
  GenerateSignInLinkResult,
  InsertCostTableInput,
  InsertCostTableResult,
  ReactivateUserResult,
  UpdateJurisdictionSettingsInput,
  UpdateJurisdictionSettingsResult,
  UserListRow,
  UserRole,
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

// ---------------------------------------------------------------------------
// G3: team user management. The only real (non-seed-script) path anywhere
// in this codebase that can create, deactivate, reactivate, or re-role a
// users row — see docs/journal/2026-08-18-g3-users.md. Every mutation here
// writes an audit_log row with before/after, same discipline as the
// cost-table and jurisdiction-settings actions above.
// ---------------------------------------------------------------------------

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Active admins in this jurisdiction right now. Used by both
 * deactivateUser and changeUserRole to enforce the last-admin lockout
 * guard rail: a jurisdiction can never be left with zero active admins
 * able to manage its own team (task instructions: "block deactivating the
 * final active admin of a jurisdiction, tested"). */
async function countActiveAdmins(client: PoolClient, jurisdictionId: string): Promise<number> {
  const res = await client.query(
    `select count(*)::int as n from users where jurisdiction_id = $1 and role = 'admin' and deactivated_at is null`,
    [jurisdictionId],
  );
  return res.rows[0].n as number;
}

/**
 * Creates a team member. Per AGENTS.md rule 8 / this task's own scope: only
 * email + role are ever collected — no password field exists anywhere in
 * this form or this function's input type. Creating the row IS the invite
 * (schema/core.sql's magic-link allowlist model: requestMagicLink refuses
 * unknown emails, so a user exists here means they are immediately
 * magic-link-eligible — see docs/journal/2026-08-18-g3-users.md for the
 * "what happens next" UI copy this powers).
 */
export async function createUser(
  jurisdictionId: string,
  actingUserId: string,
  input: CreateUserInput,
): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email);
  if (email.length === 0) return { ok: false, error: "email_required" };
  if (!isValidEmail(email)) return { ok: false, error: "email_invalid" };
  if (!isValidUserRole(input.role)) return { ok: false, error: "role_invalid" };

  return withTenant(jurisdictionId, actingUserId, async (client: PoolClient) => {
    let inserted;
    try {
      inserted = await client.query(
        `insert into users (email, jurisdiction_id, role) values ($1, $2, $3)
         returning id, email, role, created_at`,
        [email, jurisdictionId, input.role],
      );
    } catch (err) {
      // schema/core.sql: users.email is GLOBALLY unique (not per-
      // jurisdiction) — a collision with any jurisdiction's existing user
      // hits the same unique constraint.
      if (isUniqueViolation(err)) return { ok: false, error: "email_exists" };
      throw err;
    }
    const row = inserted.rows[0] as { id: string; email: string; role: UserRole; created_at: unknown };

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'user', $3, 'create', null, $4)`,
      [actingUserId, jurisdictionId, row.id, JSON.stringify({ email: row.email, role: row.role })],
    );

    const user: UserListRow = {
      id: row.id,
      email: row.email,
      role: row.role,
      createdAtIso: toIso(row.created_at),
      deactivatedAtIso: null,
    };
    return { ok: true, user };
  });
}

/**
 * Deactivates a team member: sets users.deactivated_at, refusing future
 * magic-link requests (src/core/auth/magic-link.ts) and future role-gated
 * access via requireActiveRole (src/core/auth/role-guard.ts). Never
 * deletes the row — historical assessments/determinations/audit rows they
 * authored stay attributable (schema/core.sql foreign keys), matching
 * AGENTS.md rule 11's "never deleted, status changes" spirit for the one
 * other entity in this schema that carries the same weight.
 *
 * Guard rails (task instructions): an admin cannot act on their own
 * account here (self-deactivation is a common accidental-lockout footgun
 * in admin tooling; ask another admin instead), and the final active admin
 * of a jurisdiction can never be deactivated by anyone (last-admin
 * lockout — otherwise the jurisdiction would have no one left who can
 * manage its own team).
 */
export async function deactivateUser(
  jurisdictionId: string,
  actingUserId: string,
  targetUserId: string,
): Promise<DeactivateUserResult> {
  if (targetUserId === actingUserId) return { ok: false, error: "cannot_act_on_self" };

  return withTenant(jurisdictionId, actingUserId, async (client: PoolClient) => {
    const res = await client.query(`select id, role, deactivated_at from users where id = $1 and jurisdiction_id = $2`, [
      targetUserId,
      jurisdictionId,
    ]);
    const target = res.rows[0] as { id: string; role: UserRole; deactivated_at: unknown } | undefined;
    if (!target) return { ok: false, error: "not_found" };
    if (target.deactivated_at !== null) return { ok: false, error: "already_deactivated" };

    if (target.role === "admin") {
      const activeAdmins = await countActiveAdmins(client, jurisdictionId);
      if (activeAdmins <= 1) return { ok: false, error: "last_admin" };
    }

    await client.query(`update users set deactivated_at = now() where id = $1`, [targetUserId]);

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'user', $3, 'deactivate', $4, $5)`,
      [
        actingUserId,
        jurisdictionId,
        targetUserId,
        JSON.stringify({ deactivated_at: null }),
        JSON.stringify({ deactivated_at: new Date().toISOString() }),
      ],
    );

    return { ok: true };
  });
}

/** Reactivates a previously deactivated team member. No last-admin/self
 * guard needed: reactivation only ever increases access, never removes a
 * jurisdiction's last admin. */
export async function reactivateUser(
  jurisdictionId: string,
  actingUserId: string,
  targetUserId: string,
): Promise<ReactivateUserResult> {
  return withTenant(jurisdictionId, actingUserId, async (client: PoolClient) => {
    const res = await client.query(`select id, deactivated_at from users where id = $1 and jurisdiction_id = $2`, [
      targetUserId,
      jurisdictionId,
    ]);
    const target = res.rows[0] as { id: string; deactivated_at: unknown } | undefined;
    if (!target) return { ok: false, error: "not_found" };
    if (target.deactivated_at === null) return { ok: false, error: "already_active" };

    await client.query(`update users set deactivated_at = null where id = $1`, [targetUserId]);

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'user', $3, 'reactivate', $4, $5)`,
      [
        actingUserId,
        jurisdictionId,
        targetUserId,
        JSON.stringify({ deactivated_at: toIso(target.deactivated_at) }),
        JSON.stringify({ deactivated_at: null }),
      ],
    );

    return { ok: true };
  });
}

/**
 * Changes a team member's role. Same self-protection + last-admin lockout
 * as deactivateUser: an admin cannot change their OWN role here (ask
 * another admin), and the final active admin of a jurisdiction can never
 * be demoted away from 'admin' by anyone.
 */
export async function changeUserRole(
  jurisdictionId: string,
  actingUserId: string,
  targetUserId: string,
  input: ChangeUserRoleInput,
): Promise<ChangeUserRoleResult> {
  if (targetUserId === actingUserId) return { ok: false, error: "cannot_act_on_self" };
  if (!isValidUserRole(input.role)) return { ok: false, error: "role_invalid" };

  return withTenant(jurisdictionId, actingUserId, async (client: PoolClient) => {
    const res = await client.query(`select id, role, deactivated_at from users where id = $1 and jurisdiction_id = $2`, [
      targetUserId,
      jurisdictionId,
    ]);
    const target = res.rows[0] as { id: string; role: UserRole; deactivated_at: unknown } | undefined;
    if (!target) return { ok: false, error: "not_found" };
    if (target.role === input.role) return { ok: false, error: "no_change" };

    if (target.role === "admin" && target.deactivated_at === null && input.role !== "admin") {
      const activeAdmins = await countActiveAdmins(client, jurisdictionId);
      if (activeAdmins <= 1) return { ok: false, error: "last_admin" };
    }

    await client.query(`update users set role = $1 where id = $2`, [input.role, targetUserId]);

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'user', $3, 'change_role', $4, $5)`,
      [
        actingUserId,
        jurisdictionId,
        targetUserId,
        JSON.stringify({ role: target.role }),
        JSON.stringify({ role: input.role }),
      ],
    );

    return { ok: true };
  });
}

/**
 * Generates a single-use, admin-triggered sign-in link for a team member —
 * the no-email onboarding pathway (task's THE GAP / docs/BLOCKERS.md B4).
 * Authorization (admin-only) is the caller's job (route handler, via
 * requireActiveRole); this function still independently re-checks that the
 * target belongs to THIS jurisdiction (the `and jurisdiction_id = $2` on
 * the lookup below) and is not deactivated, so it can never be used to
 * mint a working sign-in link for another jurisdiction's user or a
 * deactivated account, regardless of what the caller passes.
 *
 * Rate limiting lives in the route handler (app/api/admin/users/
 * [userId]/sign-in-link/route.ts), matching this codebase's existing
 * convention (app/api/auth/request-link/route.ts) of keeping
 * checkRateLimit calls at the HTTP boundary, not inside core actions.
 *
 * Security: never logs the raw token. The audit_log row records that a
 * link was generated, for whom, and when it expires — never the token or
 * its hash.
 */
export async function generateSignInLink(
  jurisdictionId: string,
  actingUserId: string,
  targetUserId: string,
): Promise<GenerateSignInLinkResult> {
  const target = await withTenant(jurisdictionId, actingUserId, async (client: PoolClient) => {
    const res = await client.query(`select id, email, deactivated_at from users where id = $1 and jurisdiction_id = $2`, [
      targetUserId,
      jurisdictionId,
    ]);
    return res.rows[0] as { id: string; email: string; deactivated_at: unknown } | undefined;
  });
  if (!target) return { ok: false, error: "not_found" };
  if (target.deactivated_at !== null) return { ok: false, error: "user_deactivated" };

  const { token, expiresAt } = await issueSignInLinkForUser(target.id);

  await withTenant(jurisdictionId, actingUserId, (client: PoolClient) =>
    client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, before_json, after_json)
       values ($1, $2, 'user', $3, 'generate_sign_in_link', null, $4)`,
      [
        actingUserId,
        jurisdictionId,
        target.id,
        JSON.stringify({ email: target.email, expires_at: expiresAt.toISOString() }),
      ],
    ),
  );

  return {
    ok: true,
    verifyPath: `/api/auth/verify?token=${encodeURIComponent(token)}`,
    expiresAtIso: expiresAt.toISOString(),
  };
}
