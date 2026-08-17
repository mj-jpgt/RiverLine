#!/usr/bin/env node
// pnpm db:restore <file> [--target=name] [--force] — the other half of T-C6's
// backup/restore proof. Restores a scripts/ops/backup.mjs dump into a NAMED
// target database, via the same `docker exec riverline-db-1 psql` path
// backup.mjs uses for pg_dump (no local psql on PATH — see backup.mjs header).
//
// Safety: refuses to target `riverline_dev` (the real, human-used dev
// database) unless --force is explicitly passed — a restore is a destructive
// DROP + CREATE + reload of the target, not an additive merge, and doing that
// to riverline_dev by a typo'd/omitted --target would be a real data-loss
// footgun. Default target is `riverline_restore_check`, a disposable scratch
// database, matching the task's stated default.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { withDatabaseName } from "../db/ensure-database.mjs";

export const DB_CONTAINER = process.env.DB_CONTAINER ?? "riverline-db-1";
export const DB_BACKUP_USER = process.env.DB_BACKUP_USER ?? "riverline";
export const DEFAULT_TARGET_DB = "riverline_restore_check";
export const PROTECTED_DB = "riverline_dev";

export function parseRestoreArgs(argv) {
  const positional = [];
  let target = DEFAULT_TARGET_DB;
  let force = false;
  for (const arg of argv) {
    if (arg === "--force") force = true;
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length);
    else positional.push(arg);
  }
  return { file: positional[0], target, force };
}

/** Drops (if present) and recreates `targetDb` on the same Postgres server as
 * `connectionString`, so a restore always lands in a known-clean database —
 * a re-run of the restore test/CLI is idempotent, not an accumulating merge.
 * Terminates other backends on that db first (a prior test run's dangling
 * connection would otherwise block DROP DATABASE). */
export async function recreateDatabase(connectionString, targetDb) {
  const maintenanceUrl = withDatabaseName(connectionString, "postgres");
  const client = new pg.Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [targetDb],
    );
    const quoted = `"${targetDb.replace(/"/g, '""')}"`;
    await client.query(`drop database if exists ${quoted}`);
    await client.query(`create database ${quoted}`);
  } finally {
    await client.end();
  }
}

/** Pipes a dump file's contents into `psql` running inside the docker
 * container, targeting `dbName`. ON_ERROR_STOP=1 so a mid-restore SQL error
 * fails the whole restore loudly instead of silently landing a partial
 * database. */
export function runPsqlRestore(container, user, dbName, sqlFilePath) {
  const sql = readFileSync(sqlFilePath, "utf8");
  const res = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", dbName],
    { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
  );
  if (res.error) {
    throw new Error(`psql restore could not be run (is docker/${container} available?): ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`psql restore exited ${res.status}: ${res.stderr || "(no stderr)"}`);
  }
  return res.stdout;
}

/** Full restore: recreate the target db, then load the dump into it. */
export async function restoreBackup(connectionString, sqlFilePath, targetDb) {
  await recreateDatabase(connectionString, targetDb);
  runPsqlRestore(DB_CONTAINER, DB_BACKUP_USER, targetDb, sqlFilePath);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { file, target, force } = parseRestoreArgs(process.argv.slice(2));

  if (!file) {
    console.error("Usage: pnpm db:restore <backup-file> [--target=name] [--force]");
    process.exit(1);
  }
  const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!existsSync(filePath)) {
    console.error(`BLOCKER: backup file not found: ${filePath}`);
    process.exit(1);
  }
  if (target === PROTECTED_DB && !force) {
    console.error(
      `BLOCKER: refusing to restore over "${PROTECTED_DB}" without --force ` +
        `(this DROPs and recreates the target database — it is not a merge). ` +
        `Pass --target=<scratch-db-name> to restore somewhere safe, or --force ` +
        `if you really mean to overwrite ${PROTECTED_DB}.`,
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("BLOCKER: DATABASE_URL is not set. See .env.example.");
    process.exit(1);
  }

  try {
    console.log(`--- recreating database "${target}" ---`);
    await recreateDatabase(connectionString, target);
    console.log(`--- restoring ${filePath} into "${target}" via \`docker exec ${DB_CONTAINER} psql\` ---`);
    runPsqlRestore(DB_CONTAINER, DB_BACKUP_USER, target, filePath);
    console.log(`OK: restored into "${target}".`);
  } catch (err) {
    console.error("BLOCKER:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
