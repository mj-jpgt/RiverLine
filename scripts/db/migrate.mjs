#!/usr/bin/env node
// pnpm db:migrate — forward-only, numbered SQL migrations.
//
// Deliberately boring: no migration-DSL package, no down-migrations, no
// rollback machinery (see docs/adr/0004-migrations-and-local-db.md for why
// node-pg-migrate was considered and rejected). This script:
//   1. Ensures a schema_migrations tracking table exists.
//   2. Reads migrations/*.sql in filename order (NNNN_description.sql).
//   3. Applies any not yet recorded, each inside its own transaction.
//
// applyMigrations() is also imported directly by the RLS test suite
// (test/unit/db/rls.test.ts) so it can stand up `riverline_test` against the
// same real logic this CLI uses, rather than duplicating it.
//
// ADVISORY LOCK (T-W4): flagged by T-C6/C7 as a TOCTOU race — parallel
// vitest workers (or a container boot + a human running `pnpm db:migrate` by
// hand at the same time) can both read `schema_migrations`, both see the
// same file as "pending," and both try to apply it: second one in fails on
// the `schema_migrations` PRIMARY KEY (or worse, on a non-idempotent DDL
// statement) after already doing partial work. Postgres session-level
// advisory locks (`pg_advisory_lock` / `pg_advisory_unlock`) are the boring
// fix already used for this exact pattern elsewhere (e.g. Rails' and
// Flyway's own migration locking): a fixed, arbitrary bigint key, held for
// the whole migrate run on its own connection, blocks (not fails) a second
// concurrent caller until the first finishes — so two concurrent
// `applyMigrations()` calls against the same database serialize instead of
// racing, and the second one, once unblocked, sees the first's work already
// recorded in `schema_migrations` and simply applies nothing further.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../migrations");

// Fixed, arbitrary 64-bit key for the migration advisory lock. Picked once,
// must never change (a changed key would stop serializing against
// already-deployed instances holding the old key during a rolling
// upgrade). Derived from nothing meaningful — just a constant every
// migrate.mjs invocation agrees on.
const MIGRATION_LOCK_KEY = 9142_0817_001n;

export async function applyMigrations(connectionString, { log = console.log } = {}) {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    log(
      `No migration files found in ${migrationsDir}. schema/core.sql (frozen, human-authored) does not exist yet — this is expected and is a known blocker, not an error. See docs/journal/2026-08-17-toolchain.md.`,
    );
    return { applied: [] };
  }

  const client = new pg.Client({ connectionString });
  const applied = [];

  try {
    await client.connect();

    // Blocks here (does not fail) until any other concurrent
    // applyMigrations() call against this same database releases the lock.
    // Session-level, not transaction-level (pg_advisory_lock, not the _xact
    // variant) so it is held across the whole multi-migration run below, not
    // just one BEGIN/COMMIT.
    log("Acquiring migration advisory lock...");
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Re-read pending files *after* acquiring the lock: a concurrent
      // caller that got here first may have already applied some (or all)
      // of what looked pending before we blocked.
      const { rows } = await client.query("SELECT filename FROM schema_migrations");
      const already = new Set(rows.map((r) => r.filename));

      const pending = files.filter((f) => !already.has(f));
      if (pending.length === 0) {
        log("Database is up to date. No pending migrations.");
        return { applied: [] };
      }

      for (const filename of pending) {
        const sql = readFileSync(path.join(migrationsDir, filename), "utf8");
        log(`Applying ${filename} ...`);
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
          await client.query("COMMIT");
          log(`  OK: ${filename}`);
          applied.push(filename);
        } catch (err) {
          await client.query("ROLLBACK");
          log(`  FAILED: ${filename}`);
          throw err;
        }
      }

      log(`Applied ${applied.length} migration(s).`);
      return { applied };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

// CLI entrypoint — only runs when this file is executed directly (`node
// scripts/db/migrate.mjs` / `pnpm db:migrate`), not when imported.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      [
        "BLOCKER: DATABASE_URL is not set.",
        "",
        "Local dev/test: `docker compose up -d db` then set, e.g.:",
        "  DATABASE_URL=postgres://riverline:riverline@localhost:5432/riverline_dev",
        "See docker-compose.yml and docs/adr/0004-migrations-and-local-db.md.",
      ].join("\n"),
    );
    process.exit(1);
  }

  try {
    await applyMigrations(connectionString);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
