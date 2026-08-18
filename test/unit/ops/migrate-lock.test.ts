import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import { ensureDatabaseExists, withDatabaseName } from "../../../scripts/db/ensure-database.mjs";

// T-W4 loose end: scripts/db/migrate.mjs had a TOCTOU race (flagged by
// T-C6/C7) — two concurrent invocations against the same database both read
// `schema_migrations`, both see the same file(s) as pending, and can both
// try to apply them. Fixed with a Postgres session-level advisory lock
// (pg_advisory_lock) held around the whole migrate run, so a second
// concurrent caller blocks until the first finishes rather than racing it.
//
// This test proves the fix against a REAL scratch database (not mocked):
// two concurrent `applyMigrations()` calls, same connection string, same
// migrations directory (the repo's real migrations/ — whatever is
// currently frozen, including the empty-directory case if schema/core.sql
// still doesn't exist yet). Both calls must resolve without error, and
// afterwards every migration file must be recorded in `schema_migrations`
// exactly once — no duplicate-key errors, no partial/duplicate application.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. This test needs a real local Postgres.");
}

const SCRATCH_DB = "riverline_migrate_lock_test";
const scratchUrl = withDatabaseName(baseUrl, SCRATCH_DB);

let admin: pg.Client;

describe("T-W4: scripts/db/migrate.mjs advisory lock — concurrent-invocation safety", () => {
  beforeAll(async () => {
    // Fresh scratch database every run, via the maintenance connection —
    // never riverline_dev, never riverline_test.
    admin = new pg.Client({ connectionString: withDatabaseName(baseUrl, "postgres") });
    await admin.connect();
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [SCRATCH_DB],
    );
    await admin.query(`drop database if exists "${SCRATCH_DB}"`);
    await ensureDatabaseExists(scratchUrl, { log: () => {} });
  }, 60_000);

  afterAll(async () => {
    await admin?.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [SCRATCH_DB],
    );
    await admin?.query(`drop database if exists "${SCRATCH_DB}"`);
    await admin?.end();
  });

  it("two concurrent applyMigrations() calls against the same scratch db both succeed, migrations applied once", async () => {
    const logsA: string[] = [];
    const logsB: string[] = [];

    // Fire both concurrently — this is exactly the race T-C6/C7 flagged
    // (e.g. two parallel vitest workers, or a container boot racing a
    // human running `pnpm db:migrate` by hand).
    const [resultA, resultB] = await Promise.all([
      applyMigrations(scratchUrl, { log: (m: string) => logsA.push(m) }),
      applyMigrations(scratchUrl, { log: (m: string) => logsB.push(m) }),
    ]);

    // Neither call threw (Promise.all would have rejected otherwise) — the
    // pre-fix behavior was a duplicate-key error on schema_migrations from
    // whichever call lost the race.
    expect(resultA).toBeDefined();
    expect(resultB).toBeDefined();

    const verify = new pg.Client({ connectionString: scratchUrl });
    await verify.connect();
    try {
      const migrationsTableExists = await verify.query(
        `select 1 from information_schema.tables where table_name = 'schema_migrations'`,
      );

      if (migrationsTableExists.rows.length === 0) {
        // No migration files exist yet (schema/core.sql not written) — both
        // calls should have taken the early "no migration files found"
        // branch, applying nothing. Still a valid pass: the point is no
        // error, no partial state, not that files exist.
        expect(resultA.applied).toEqual([]);
        expect(resultB.applied).toEqual([]);
        return;
      }

      const { rows } = await verify.query(
        "select filename, count(*)::int as n from schema_migrations group by filename",
      );
      // Every applied migration recorded exactly once — the PRIMARY KEY on
      // filename would already enforce this at the DB level, but assert it
      // explicitly so this test documents the guarantee, not just "it
      // didn't throw".
      for (const row of rows) {
        expect(row.n).toBe(1);
      }

      // Combined, the two calls applied every migration exactly once
      // between them (whichever call got the lock first did the real
      // work; the other found nothing left pending once it acquired the
      // lock second).
      const totalApplied = resultA.applied.length + resultB.applied.length;
      expect(totalApplied).toBe(rows.length);
    } finally {
      await verify.end();
    }
  }, 60_000);
});
