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
// schema/core.sql is the FROZEN human-authored source of truth for the core
// tables (AGENTS.md rule 1) and does not exist yet as of this writing — see
// the journal entry for 2026-08-17. Until it lands, migrations/ has nothing
// to migrate; this script will report zero pending migrations, correctly.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../migrations");

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

const files = readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

if (files.length === 0) {
  console.log(
    `No migration files found in ${migrationsDir}. schema/core.sql (frozen, human-authored) does not exist yet — this is expected and is a known blocker, not an error. See docs/journal/2026-08-17-toolchain.md.`,
  );
  process.exit(0);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("Database is up to date. No pending migrations.");
    process.exit(0);
  }

  for (const filename of pending) {
    const sql = readFileSync(path.join(migrationsDir, filename), "utf8");
    console.log(`Applying ${filename} ...`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`  OK: ${filename}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  FAILED: ${filename}`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log(`Applied ${pending.length} migration(s).`);
} finally {
  await client.end();
}
