#!/usr/bin/env node
// pnpm db:backup — pg_dump proof (build spec §7.5, §10.6 / specs/core/tasks.md
// T-C6). Local machine has no pg_dump/psql on PATH (verified: `which pg_dump`
// -> not found, this session) but the running postgis/postgis:16-3.4
// container (docs/adr/0004, docker-compose.yml service `db`, container name
// `riverline-db-1`) ships matching-version client tools — `docker exec
// riverline-db-1 pg_dump ...` is what actually works here, not assumed.
//
// Plain-SQL dump (`pg_dump`'s default `-F p`), not custom/directory format:
// restorable with a plain `psql < file` (scripts/ops/restore.mjs), readable
// in an editor for a human doing an emergency restore, same "boring, no new
// tooling" choice ADR 0004 already made for migrations.
//
// --no-owner --no-privileges: the dump is portable across a differently-named
// restore role (the scratch/target db is created fresh by restore.mjs, owned
// by whatever role runs the restore) — without these flags, a restore would
// fail trying to `ALTER ... OWNER TO riverline` if the target session's role
// differs.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
export const BACKUPS_DIR = path.join(root, "backups");

export const DB_CONTAINER = process.env.DB_CONTAINER ?? "riverline-db-1";
export const DB_BACKUP_USER = process.env.DB_BACKUP_USER ?? "riverline";
export const DB_BACKUP_DATABASE = process.env.DB_BACKUP_DATABASE ?? "riverline_dev";

/** ISO timestamp, filesystem-safe (colons/dots -> dashes). */
export function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** Runs `pg_dump` for `dbName` inside the given docker container, returns the
 * dump text. Throws with stderr on a nonzero exit rather than returning a
 * possibly-empty/truncated dump silently. */
export function runPgDump(container, user, dbName) {
  const res = spawnSync(
    "docker",
    ["exec", container, "pg_dump", "-U", user, "-d", dbName, "--no-owner", "--no-privileges"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
  );
  if (res.error) {
    throw new Error(`pg_dump could not be run (is docker/${container} available?): ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`pg_dump exited ${res.status}: ${res.stderr || "(no stderr)"}`);
  }
  if (!res.stdout || res.stdout.trim().length === 0) {
    throw new Error("pg_dump produced empty output — refusing to write a hollow backup file.");
  }
  return res.stdout;
}

/** Writes dump text to backups/<timestamp>.sql (dir created if needed,
 * gitignored — see .gitignore). Returns the full path written. */
export function writeBackup(sql, timestamp = backupTimestamp()) {
  if (!existsSync(BACKUPS_DIR)) mkdirSync(BACKUPS_DIR, { recursive: true });
  const filePath = path.join(BACKUPS_DIR, `${timestamp}.sql`);
  writeFileSync(filePath, sql, "utf8");
  return filePath;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  console.log(`--- pg_dump ${DB_BACKUP_DATABASE} via \`docker exec ${DB_CONTAINER} pg_dump\` ---`);
  try {
    const sql = runPgDump(DB_CONTAINER, DB_BACKUP_USER, DB_BACKUP_DATABASE);
    const filePath = writeBackup(sql);
    console.log(`OK: wrote ${filePath} (${(sql.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error("BLOCKER:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
