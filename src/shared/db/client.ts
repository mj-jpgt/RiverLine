// The only sanctioned way for feature code to talk to Postgres.
//
// withTenant() is the request-scoped path: every call sets
// app.jurisdiction_id and app.user_id via set_config(..., true) (transaction
// -local — cleared at COMMIT/ROLLBACK) *and* SET LOCAL ROLE to the
// non-superuser `riverline_app` role (see migrations/0003_app_role.sql) so
// Row-Level Security in schema/core.sql is actually enforced. The local dev
// Postgres user (DATABASE_URL) is a superuser, and superusers always bypass
// RLS regardless of FORCE ROW LEVEL SECURITY — that's a hard Postgres rule.
// Without the SET LOCAL ROLE switch, RLS would silently never apply.
//
// withSystem() is a narrow, explicitly-named escape hatch for the one place
// in this codebase that legitimately has no jurisdiction context yet:
// pre-authentication magic-link lookups (src/core/auth) — finding which
// user/jurisdiction an email belongs to before any session exists. It runs
// as the superuser connection with no SET ROLE, so it bypasses RLS
// entirely. It must never be used for tenant-scoped business data.
import type { Pool, PoolClient } from "pg";
import { getPool } from "./pool";

const APP_ROLE = "riverline_app";

async function inTransaction<T>(pool: Pool, body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Request-scoped db access. Every feature-code query that touches tenant
 * data (structures, assessments, calculations, determinations, ...) must go
 * through this. `userId` may be null only for system-initiated writes that
 * still need jurisdiction scoping but have no acting user (rare in
 * practice); audit_log.actor_user_id will be null in that case.
 */
export async function withTenant<T>(
  jurisdictionId: string,
  userId: string | null,
  body: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  return inTransaction(pool, async (client) => {
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    await client.query("SELECT set_config('app.jurisdiction_id', $1, true)", [jurisdictionId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
    return body(client);
  });
}

/**
 * Pre-authentication escape hatch ONLY. No jurisdiction context, bypasses
 * RLS (runs as the superuser connection). Used by src/core/auth for
 * magic-link issuance/verification, where the user's jurisdiction is not
 * yet known. Do not use this for anything else — if you're reaching for
 * withSystem outside src/core/auth, you probably want withTenant.
 */
export async function withSystem<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  return inTransaction(pool, body);
}
