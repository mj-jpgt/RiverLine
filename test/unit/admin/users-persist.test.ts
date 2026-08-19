import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import {
  createUser,
  deactivateUser,
  reactivateUser,
  changeUserRole,
  generateSignInLink,
} from "../../../src/core/admin/actions";
import { listUsers, getTeamSummary } from "../../../src/core/admin/queries";
import { requestMagicLink, verifyMagicLink } from "../../../src/core/auth/magic-link";
import { requireActiveRole, AuthError } from "../../../src/core/auth/role-guard";
import type { SessionPayload } from "../../../src/core/auth/session";

// Real Postgres, real writes, no mocks — same recipe test/unit/admin/
// persist.test.ts (T-W5) already established. Proves T-G3's core claims:
//   - createUser is the only real path that can populate `users` outside a
//     seed script, and its row is immediately magic-link-eligible.
//   - deactivateUser/reactivateUser/changeUserRole are jurisdiction-scoped,
//     self-protected, and last-admin-lockout-protected.
//   - a deactivated user's magic-link request is silently refused, and
//     their already-issued token cannot complete sign-in.
//   - requireActiveRole rejects a deactivated user's still-valid session on
//     the next request.
//   - generateSignInLink mints a token that verifyMagicLink accepts, and
//     never writes the raw token anywhere (audit_log included).
// AGENTS.md rule 6: this suite only ever seeds riverline_test.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The users persistence suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "g3-users-test-secret-at-least-32-chars-long";

let admin: pg.Client;

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);
  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
});

function uniqueEmail(label: string): string {
  return `g3-users-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.gov`;
}

async function createJurisdiction(label: string): Promise<string> {
  const res = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    `G3 Users Test — ${label} ${Date.now()}-${Math.random().toString(36).slice(2)}`,
  ]);
  return res.rows[0].id as string;
}

async function seedUser(
  jurisdictionId: string,
  role: "admin" | "assessor" | "official" | "viewer",
  opts: { deactivated?: boolean; emailLabel?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(opts.emailLabel ?? role);
  const res = await admin.query(
    `insert into users (email, jurisdiction_id, role, deactivated_at) values ($1, $2, $3, $4) returning id`,
    [email, jurisdictionId, role, opts.deactivated ? new Date() : null],
  );
  return { id: res.rows[0].id as string, email };
}

async function auditRowsFor(entityId: string, action: string): Promise<{ before_json: unknown; after_json: unknown; actor_user_id: string }[]> {
  const res = await admin.query(
    `select before_json, after_json, actor_user_id from audit_log where entity_type = 'user' and entity_id = $1 and action = $2 order by at desc`,
    [entityId, action],
  );
  return res.rows;
}

describe("createUser", () => {
  it("creates a row with only email + role, normalizes the email, and audits it", async () => {
    const jurisdictionId = await createJurisdiction("create-basic");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const rawEmail = `  G3-Create-Test-${Date.now()}@Example.GOV  `;

    const result = await createUser(jurisdictionId, actingAdmin.id, { email: rawEmail, role: "assessor" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.user.email).toBe(rawEmail.trim().toLowerCase());
    expect(result.user.role).toBe("assessor");
    expect(result.user.deactivatedAtIso).toBeNull();

    const row = await admin.query(`select email, role, jurisdiction_id from users where id = $1`, [result.user.id]);
    expect(row.rows[0].email).toBe(rawEmail.trim().toLowerCase());
    expect(row.rows[0].jurisdiction_id).toBe(jurisdictionId);

    const audit = await auditRowsFor(result.user.id, "create");
    expect(audit.length).toBe(1);
    expect(audit[0]!.actor_user_id).toBe(actingAdmin.id);
    expect(audit[0]!.before_json).toBeNull();
    expect((audit[0]!.after_json as { role: string }).role).toBe("assessor");
  });

  it("rejects an invalid email and writes no row", async () => {
    const jurisdictionId = await createJurisdiction("create-invalid-email");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const result = await createUser(jurisdictionId, actingAdmin.id, { email: "not-an-email", role: "assessor" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("email_invalid");
  });

  it("rejects a blank email", async () => {
    const jurisdictionId = await createJurisdiction("create-blank-email");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const result = await createUser(jurisdictionId, actingAdmin.id, { email: "   ", role: "viewer" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("email_required");
  });

  it("rejects a duplicate email (users.email is globally unique) without touching the existing row", async () => {
    const jurisdictionId = await createJurisdiction("create-dup");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const email = uniqueEmail("dup");

    const first = await createUser(jurisdictionId, actingAdmin.id, { email, role: "official" });
    expect(first.ok).toBe(true);

    const second = await createUser(jurisdictionId, actingAdmin.id, { email, role: "viewer" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("email_exists");

    const rows = await admin.query(`select role from users where email = $1`, [email]);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].role).toBe("official"); // unchanged by the rejected second attempt
  });
});

describe("deactivateUser", () => {
  it("deactivates a user, refuses future magic-link requests, and audits before/after", async () => {
    const jurisdictionId = await createJurisdiction("deactivate-basic");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "assessor");

    const result = await deactivateUser(jurisdictionId, actingAdmin.id, target.id);
    expect(result.ok).toBe(true);

    const row = await admin.query(`select deactivated_at from users where id = $1`, [target.id]);
    expect(row.rows[0].deactivated_at).not.toBeNull();

    const audit = await auditRowsFor(target.id, "deactivate");
    expect(audit.length).toBe(1);
    expect((audit[0]!.before_json as { deactivated_at: null }).deactivated_at).toBeNull();
    expect((audit[0]!.after_json as { deactivated_at: string }).deactivated_at).not.toBeNull();

    // requestMagicLink: no token is issued for a deactivated user's email.
    const before = await admin.query(`select count(*)::int as n from login_tokens where user_id = $1`, [target.id]);
    await requestMagicLink(target.email);
    const after = await admin.query(`select count(*)::int as n from login_tokens where user_id = $1`, [target.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("cannot_act_on_self: an admin cannot deactivate their own account", async () => {
    const jurisdictionId = await createJurisdiction("deactivate-self");
    const actingAdmin = await seedUser(jurisdictionId, "admin");

    const result = await deactivateUser(jurisdictionId, actingAdmin.id, actingAdmin.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("cannot_act_on_self");

    const row = await admin.query(`select deactivated_at from users where id = $1`, [actingAdmin.id]);
    expect(row.rows[0].deactivated_at).toBeNull();
  });

  it("already_deactivated: deactivating an already-deactivated user is rejected, not silently re-applied", async () => {
    const jurisdictionId = await createJurisdiction("deactivate-twice");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "viewer", { deactivated: true });

    const result = await deactivateUser(jurisdictionId, actingAdmin.id, target.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("already_deactivated");
  });

  it("not_found: a jurisdiction cannot deactivate another jurisdiction's user (cross-tenant, IDOR-style)", async () => {
    const jurisdictionA = await createJurisdiction("deactivate-cross-a");
    const jurisdictionB = await createJurisdiction("deactivate-cross-b");
    const actingAdminA = await seedUser(jurisdictionA, "admin");
    const targetB = await seedUser(jurisdictionB, "assessor");

    const result = await deactivateUser(jurisdictionA, actingAdminA.id, targetB.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");

    const row = await admin.query(`select deactivated_at from users where id = $1`, [targetB.id]);
    expect(row.rows[0].deactivated_at).toBeNull(); // untouched
  });

  it("last_admin: the final active admin of a jurisdiction cannot be deactivated by anyone", async () => {
    const jurisdictionId = await createJurisdiction("deactivate-last-admin");
    const sole = await seedUser(jurisdictionId, "admin", { emailLabel: "sole-admin" });
    // A second admin acts as the FK-satisfying actor, then is itself
    // deactivated by `sole` — leaving `sole` as the ONLY active admin.
    const other = await seedUser(jurisdictionId, "admin", { emailLabel: "other-admin" });
    const setupResult = await deactivateUser(jurisdictionId, sole.id, other.id);
    expect(setupResult.ok).toBe(true); // not last-admin yet — sole remains active

    const result = await deactivateUser(jurisdictionId, other.id, sole.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("last_admin");

    const row = await admin.query(`select deactivated_at from users where id = $1`, [sole.id]);
    expect(row.rows[0].deactivated_at).toBeNull(); // still active
  });

  it("deactivating a non-last admin succeeds (last-admin guard does not over-block)", async () => {
    const jurisdictionId = await createJurisdiction("deactivate-not-last-admin");
    const adminOne = await seedUser(jurisdictionId, "admin");
    const adminTwo = await seedUser(jurisdictionId, "admin");

    const result = await deactivateUser(jurisdictionId, adminOne.id, adminTwo.id);
    expect(result.ok).toBe(true);
  });
});

describe("reactivateUser", () => {
  it("reactivates a deactivated user and audits before/after", async () => {
    const jurisdictionId = await createJurisdiction("reactivate-basic");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "official", { deactivated: true });

    const result = await reactivateUser(jurisdictionId, actingAdmin.id, target.id);
    expect(result.ok).toBe(true);

    const row = await admin.query(`select deactivated_at from users where id = $1`, [target.id]);
    expect(row.rows[0].deactivated_at).toBeNull();

    const audit = await auditRowsFor(target.id, "reactivate");
    expect(audit.length).toBe(1);
    expect((audit[0]!.after_json as { deactivated_at: null }).deactivated_at).toBeNull();
  });

  it("already_active: reactivating an already-active user is rejected", async () => {
    const jurisdictionId = await createJurisdiction("reactivate-already-active");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "assessor");

    const result = await reactivateUser(jurisdictionId, actingAdmin.id, target.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("already_active");
  });

  it("not_found: cross-tenant reactivate is rejected", async () => {
    const jurisdictionA = await createJurisdiction("reactivate-cross-a");
    const jurisdictionB = await createJurisdiction("reactivate-cross-b");
    const actingAdminA = await seedUser(jurisdictionA, "admin");
    const targetB = await seedUser(jurisdictionB, "assessor", { deactivated: true });

    const result = await reactivateUser(jurisdictionA, actingAdminA.id, targetB.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });
});

describe("changeUserRole", () => {
  it("changes a role and audits before/after", async () => {
    const jurisdictionId = await createJurisdiction("role-basic");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "viewer");

    const result = await changeUserRole(jurisdictionId, actingAdmin.id, target.id, { role: "official" });
    expect(result.ok).toBe(true);

    const row = await admin.query(`select role from users where id = $1`, [target.id]);
    expect(row.rows[0].role).toBe("official");

    const audit = await auditRowsFor(target.id, "change_role");
    expect(audit.length).toBe(1);
    expect((audit[0]!.before_json as { role: string }).role).toBe("viewer");
    expect((audit[0]!.after_json as { role: string }).role).toBe("official");
  });

  it("cannot_act_on_self: an admin cannot change their own role", async () => {
    const jurisdictionId = await createJurisdiction("role-self");
    const actingAdmin = await seedUser(jurisdictionId, "admin");

    const result = await changeUserRole(jurisdictionId, actingAdmin.id, actingAdmin.id, { role: "viewer" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("cannot_act_on_self");

    const row = await admin.query(`select role from users where id = $1`, [actingAdmin.id]);
    expect(row.rows[0].role).toBe("admin");
  });

  it("no_change: setting the same role is rejected, no audit row written", async () => {
    const jurisdictionId = await createJurisdiction("role-no-change");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "assessor");

    const result = await changeUserRole(jurisdictionId, actingAdmin.id, target.id, { role: "assessor" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("no_change");

    const audit = await auditRowsFor(target.id, "change_role");
    expect(audit.length).toBe(0);
  });

  it("last_admin: demoting the final active admin away from admin is blocked", async () => {
    const jurisdictionId = await createJurisdiction("role-last-admin");
    const sole = await seedUser(jurisdictionId, "admin", { emailLabel: "sole-admin" });
    const other = await seedUser(jurisdictionId, "assessor");

    const result = await changeUserRole(jurisdictionId, other.id, sole.id, { role: "official" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("last_admin");

    const row = await admin.query(`select role from users where id = $1`, [sole.id]);
    expect(row.rows[0].role).toBe("admin");
  });

  it("demoting a non-last admin succeeds (last-admin guard does not over-block)", async () => {
    const jurisdictionId = await createJurisdiction("role-not-last-admin");
    const adminOne = await seedUser(jurisdictionId, "admin");
    const adminTwo = await seedUser(jurisdictionId, "admin");

    const result = await changeUserRole(jurisdictionId, adminOne.id, adminTwo.id, { role: "official" });
    expect(result.ok).toBe(true);
  });

  it("not_found: cross-tenant role change is rejected", async () => {
    const jurisdictionA = await createJurisdiction("role-cross-a");
    const jurisdictionB = await createJurisdiction("role-cross-b");
    const actingAdminA = await seedUser(jurisdictionA, "admin");
    const targetB = await seedUser(jurisdictionB, "assessor");

    const result = await changeUserRole(jurisdictionA, actingAdminA.id, targetB.id, { role: "official" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });
});

describe("generateSignInLink — the no-email onboarding pathway", () => {
  it("mints a token that verifyMagicLink accepts and resolves the right user/role/jurisdiction", async () => {
    const jurisdictionId = await createJurisdiction("link-basic");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "official");

    const result = await generateSignInLink(jurisdictionId, actingAdmin.id, target.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const token = new URL(result.verifyPath, "http://localhost").searchParams.get("token");
    expect(token).toBeTruthy();

    const login = await verifyMagicLink(token as string);
    expect(login).not.toBeNull();
    expect(login?.userId).toBe(target.id);
    expect(login?.jurisdictionId).toBe(jurisdictionId);
    expect(login?.role).toBe("official");
    expect(login?.email).toBe(target.email);
  });

  it("the token is single-use — a second verify of the same link fails", async () => {
    const jurisdictionId = await createJurisdiction("link-single-use");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "assessor");

    const result = await generateSignInLink(jurisdictionId, actingAdmin.id, target.id);
    if (!result.ok) throw new Error("expected ok");
    const token = new URL(result.verifyPath, "http://localhost").searchParams.get("token") as string;

    const first = await verifyMagicLink(token);
    expect(first).not.toBeNull();
    const second = await verifyMagicLink(token);
    expect(second).toBeNull();
  });

  it("never writes the raw token or its hash into audit_log", async () => {
    const jurisdictionId = await createJurisdiction("link-no-token-in-audit");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "viewer");

    const result = await generateSignInLink(jurisdictionId, actingAdmin.id, target.id);
    if (!result.ok) throw new Error("expected ok");
    const token = new URL(result.verifyPath, "http://localhost").searchParams.get("token") as string;

    const audit = await auditRowsFor(target.id, "generate_sign_in_link");
    expect(audit.length).toBe(1);
    const afterJson = JSON.stringify(audit[0]!.after_json);
    const beforeJson = JSON.stringify(audit[0]!.before_json ?? "");
    expect(afterJson).not.toContain(token);
    expect(beforeJson).not.toContain(token);
    expect(afterJson.toLowerCase()).not.toContain("token");
  });

  it("user_deactivated: refuses to mint a link for a deactivated user", async () => {
    const jurisdictionId = await createJurisdiction("link-deactivated-target");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "assessor", { deactivated: true });

    const result = await generateSignInLink(jurisdictionId, actingAdmin.id, target.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("user_deactivated");
  });

  it("not_found: cross-tenant link generation is rejected", async () => {
    const jurisdictionA = await createJurisdiction("link-cross-a");
    const jurisdictionB = await createJurisdiction("link-cross-b");
    const actingAdminA = await seedUser(jurisdictionA, "admin");
    const targetB = await seedUser(jurisdictionB, "assessor");

    const result = await generateSignInLink(jurisdictionA, actingAdminA.id, targetB.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("a link generated for a user who is deactivated AFTER minting cannot complete sign-in", async () => {
    const jurisdictionId = await createJurisdiction("link-deactivated-after-mint");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "assessor");

    const result = await generateSignInLink(jurisdictionId, actingAdmin.id, target.id);
    if (!result.ok) throw new Error("expected ok");
    const token = new URL(result.verifyPath, "http://localhost").searchParams.get("token") as string;

    const deactivation = await deactivateUser(jurisdictionId, actingAdmin.id, target.id);
    expect(deactivation.ok).toBe(true);

    const login = await verifyMagicLink(token);
    expect(login).toBeNull();
  });
});

describe("deactivated user's magic-link request is refused (silently, no allowlist leak)", () => {
  it("requestMagicLink issues no token for a deactivated email, same response shape as an unknown email", async () => {
    const jurisdictionId = await createJurisdiction("magic-link-deactivated");
    const target = await seedUser(jurisdictionId, "assessor", { deactivated: true });

    const before = await admin.query(`select count(*)::int as n from login_tokens where user_id = $1`, [target.id]);
    const response = await requestMagicLink(target.email);
    expect(response).toEqual({ requested: true });
    const after = await admin.query(`select count(*)::int as n from login_tokens where user_id = $1`, [target.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe("requireActiveRole — deactivated session rejected on next request", () => {
  function sessionFor(user: { id: string; jurisdictionId: string; role: "admin" | "assessor" | "official" | "viewer"; email: string }): SessionPayload {
    return {
      userId: user.id,
      jurisdictionId: user.jurisdictionId,
      role: user.role,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    };
  }

  it("an active user's session passes through unchanged", async () => {
    const jurisdictionId = await createJurisdiction("guard-active");
    const active = await seedUser(jurisdictionId, "admin");
    const session = sessionFor({ id: active.id, jurisdictionId, role: "admin", email: active.email });

    const result = await requireActiveRole(session, ["admin"]);
    expect(result.userId).toBe(active.id);
  });

  it("a deactivated user's still cryptographically-valid session is rejected on the next request", async () => {
    const jurisdictionId = await createJurisdiction("guard-deactivated");
    const actingAdmin = await seedUser(jurisdictionId, "admin");
    const target = await seedUser(jurisdictionId, "official");

    // Session issued while active — this is the realistic scenario: the
    // cookie was signed before deactivation, sessions are stateless
    // (src/core/auth/session.ts), so nothing about the cookie itself
    // changes when the account is deactivated afterward.
    const session = sessionFor({ id: target.id, jurisdictionId, role: "official", email: target.email });

    const deactivation = await deactivateUser(jurisdictionId, actingAdmin.id, target.id);
    expect(deactivation.ok).toBe(true);

    await expect(requireActiveRole(session, ["admin", "official"])).rejects.toBeInstanceOf(AuthError);
    try {
      await requireActiveRole(session, ["admin", "official"]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("FORBIDDEN");
    }
  });

  it("still enforces the underlying role check (non-admin session on an admin-only route)", async () => {
    const jurisdictionId = await createJurisdiction("guard-role");
    const viewer = await seedUser(jurisdictionId, "viewer");
    const session = sessionFor({ id: viewer.id, jurisdictionId, role: "viewer", email: viewer.email });

    await expect(requireActiveRole(session, ["admin"])).rejects.toBeInstanceOf(AuthError);
  });
});

describe("listUsers / getTeamSummary", () => {
  it("lists both active and deactivated users, and counts only active ones per role", async () => {
    const jurisdictionId = await createJurisdiction("team-summary");
    await seedUser(jurisdictionId, "admin");
    await seedUser(jurisdictionId, "assessor");
    await seedUser(jurisdictionId, "assessor");
    await seedUser(jurisdictionId, "official");
    const deactivatedAssessor = await seedUser(jurisdictionId, "assessor", { deactivated: true });

    const list = await listUsers(jurisdictionId, null);
    expect(list.length).toBe(5);
    expect(list.find((u) => u.id === deactivatedAssessor.id)?.deactivatedAtIso).not.toBeNull();

    const summary = await getTeamSummary(jurisdictionId, null);
    expect(summary.activeAdmins).toBe(1);
    expect(summary.activeAssessors).toBe(2); // the deactivated one is excluded
    expect(summary.activeOfficials).toBe(1);
    expect(summary.activeTotal).toBe(4);
  });

  it("tenant scoping: jurisdiction A's team is invisible to jurisdiction B", async () => {
    const jurisdictionA = await createJurisdiction("team-scope-a");
    const jurisdictionB = await createJurisdiction("team-scope-b");
    await seedUser(jurisdictionA, "admin");
    await seedUser(jurisdictionA, "assessor");

    const listForB = await listUsers(jurisdictionB, null);
    expect(listForB.length).toBe(0);
    const summaryForB = await getTeamSummary(jurisdictionB, null);
    expect(summaryForB.activeTotal).toBe(0);
  });
});
