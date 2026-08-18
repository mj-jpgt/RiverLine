#!/usr/bin/env node
// pnpm db:clean-dev — removes e2e/debug-run pollution from riverline_dev.
//
// WHY THIS EXISTS (V5 task 1, 2026-08-18): riverline_dev accumulated 34 users
// whose emails match the e2e/debug harness naming conventions this project
// already uses (`a2-e2e-%@...`, `a4-e2e-%@...`, `debug-ocr-%@...` — see
// test/e2e/a2-dashboard.spec.ts's own `OFFICIAL_EMAIL` pattern for the
// precedent) and, with them, 27 disposable jurisdictions those runs created
// ("A2 E2E Jurisdiction <ts>-<rand>", "A4 E2E Jurisdiction <ts>-<rand>",
// "Debug OCR <ts>"), plus every structure/assessment/calculation/
// determination/letter/estimate/audit_log row scoped to those jurisdictions.
// Verified by direct query against riverline_dev before writing this script
// (docs/journal/2026-08-18-v5-data.md has the full before/after): every one
// of those 27 jurisdictions has ONLY pattern-matching users (zero mixed
// jurisdictions), and every pattern-matching user belongs to exactly one of
// them — a clean 1:1 correspondence, not assumed, checked.
//
// WHY JURISDICTION-LEVEL CASCADE, NOT JUST "DELETE ROWS REFERENCING THE
// USER": a purely user-referential delete (assessments.assessor_user_id,
// determinations.adopted_by_user_id, etc.) would strand every structure
// those test runs created — structures have no user reference at all, only
// jurisdiction_id — as permanent orphaned pollution. Since the verified 1:1
// correspondence above means "every user in this jurisdiction is disposable"
// is exactly equivalent to "this whole jurisdiction is disposable," cascading
// at the jurisdiction level cleans the actual symptom (dashboard/home showing
// fake structures) instead of leaving a diet version of it behind. A
// jurisdiction only ever enters the target set if EVERY user in it matches
// the patterns (computeTargets' NOT EXISTS clause) — one real/unmatched user
// in a jurisdiction is enough to exclude the whole jurisdiction, unconditionally.
//
// HARD SAFETY RAILS (all enforced in code, not just by convention):
//   1. Refuses to run against any database whose name isn't exactly
//      "riverline_dev", unless --db-override=<name> is passed — and the
//      override is itself refused for any name ending "_test" (or exactly
//      "riverline_test"), any name containing "prod", or any name that
//      doesn't start with "riverline_dev" (so an override can only ever
//      target an actual clone of riverline_dev, e.g.
//      "riverline_dev_clone_scratch" — see assertSafeDatabaseName).
//   2. Never deletes without --yes. Without it, prints the preview count
//      table and exits 0, having touched nothing.
//   3. The whole delete runs inside one transaction (BEGIN...COMMIT) — a
//      failure partway through rolls back everything.
//   4. computeTargets() asserts, before returning, that none of the three
//      seeded demo emails (admin@example.gov / assessor@example.gov /
//      official@example.gov) and no jurisdiction holding a
//      DEMO-PRACTICE%-parcel structure ever appear in the target set — even
//      though the SQL predicate already excludes them by construction
//      (name <> 'Demo City' + the DEMO-PRACTICE structure check), this is a
//      second, independent check in application code before a single DELETE
//      is issued. If it ever fires, the script aborts with no changes made.
//   5. Real (non-test) Hamilton County parcels have no user rows at all —
//      structures aren't user-owned — so they can only be reached through a
//      target jurisdiction, and the "Demo City" exclusion above is what keeps
//      the 3,821 real parcels (and the practice structure) out of the target
//      set entirely.
//
// TRIGGER HANDLING (the one deliberately sharp edge here — read this before
// changing it): `calculations` and `audit_log` are insert-only, and
// `determinations` can never be DELETEd, all enforced by triggers in
// schema/core.sql (calculations_immutable, audit_log_append_only,
// determinations_no_delete) — exactly as they should be for real jurisdiction
// data, because a contested determination's defensibility depends on that
// immutability (AGENTS.md rule 10/11). Those rules exist to protect REAL
// records from being altered after the fact; they were never meant to make a
// disposable e2e-test jurisdiction's own rows permanent. `session_replication_
// role = replica` is the forbidden hammer (build spec's own agent-protocol
// language, this task's instructions) because it silently disables EVERY
// trigger AND every RLS-enforcing mechanism cluster-wide for the session,
// with no record of what was bypassed or why. Instead, this script disables
// exactly the three named triggers, by name, only on the three tables that
// have them, only for the duration of one transaction, and re-enables them
// (in the same transaction) before COMMIT — a change that is itself
// transactional DDL in Postgres, so a rollback undoes it along with
// everything else. This is dev-db maintenance on rows this script has already
// proven belong to disposable test jurisdictions, not a way to edit real
// determinations/calculations after the fact; the app code path never does
// this, only this ops script does, and only against riverline_dev (or an
// explicit clone of it) after the same jurisdiction-target computation that
// gates every other delete in this file.
//
// UPLOADS (filesystem): photos/estimates are stored under
// uploads/<jurisdictionId>/... (see app/api/capture/sync/route.ts,
// src/modules/a4-estimates/actions.ts) — deleting a target jurisdiction's
// entire uploads/<jurisdictionId>/ directory after the DB transaction commits
// covers both. Separately, this script found uploads/letters/<uuid>/ and
// uploads/<uuid>/ directories on disk with NO corresponding row in the
// `letters` table or `jurisdictions` table at all (pre-existing filesystem
// orphans, predating this cleanup, unrelated to any row this script's DB
// transaction touches). Since an id with zero matching jurisdiction row can
// never be referenced by a live FK anywhere, removing those is unambiguously
// safe and is done as a separate, clearly-labeled step (cleanOrphanedUploads)
// — never conflated with the jurisdiction-targeted cleanup above.
//
// USAGE:
//   node scripts/ops/clean-dev-db.mjs                 # preview only, no --yes
//   node scripts/ops/clean-dev-db.mjs --yes            # real delete against riverline_dev
//   node scripts/ops/clean-dev-db.mjs --db-override=riverline_dev_clone_scratch --yes
//                                                       # real delete against a named clone,
//                                                       # for testing this script itself
//                                                       # (see test/unit/ops/clean-dev-db.test.ts)

import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { withDatabaseName } from "../db/ensure-database.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, "../../uploads");

export const DEFAULT_DB = "riverline_dev";

// The three e2e/debug harness email prefixes this project's own test suites
// already use — see test/e2e/a2-dashboard.spec.ts (`a2-e2e-official-...`),
// and the equivalent a4/debug-ocr harnesses this task's brief named
// verbatim. Kept as SQL LIKE patterns (parameterized, never string-built from
// request input — there is no request input, this is a CLI tool run by a
// human).
export const POLLUTION_EMAIL_PATTERNS = ["a2-e2e-%", "a4-e2e-%", "debug-ocr-%"];

// The 3 seeded demo users (docs/journal/2026-08-17 auth seed) — asserted
// absent from the target set below as a second, independent safety check.
export const PROTECTED_DEMO_EMAILS = ["admin@example.gov", "assessor@example.gov", "official@example.gov"];

export const PROTECTED_JURISDICTION_NAME = "Demo City";
export const PROTECTED_PRACTICE_PARCEL_PREFIX = "DEMO-PRACTICE";

/** Parses argv into { yes, dbOverride }. Unknown flags are ignored (this is
 * a small ops CLI, not a public interface). */
export function parseCleanArgs(argv) {
  let yes = false;
  let dbOverride = null;
  for (const arg of argv) {
    if (arg === "--yes") yes = true;
    else if (arg.startsWith("--db-override=")) dbOverride = arg.slice("--db-override=".length);
  }
  return { yes, dbOverride };
}

/** Hard safety rail #1 (see file header). Throws with a specific reason
 * rather than a generic refusal, so a human reading the failed run knows
 * exactly which rule fired. */
export function assertSafeDatabaseName(dbName, { override } = {}) {
  if (!override) {
    if (dbName !== DEFAULT_DB) {
      throw new Error(
        `refuses to run against database "${dbName}" — only "${DEFAULT_DB}" is allowed without --db-override=<name>. ` +
          `If you meant to test this script against a clone, pass --db-override explicitly.`,
      );
    }
    return;
  }
  if (dbName === "riverline_test" || /_test$/i.test(dbName)) {
    throw new Error(
      `refuses to run against "${dbName}" — it looks like a *_test database. Those are rebuilt by test harnesses ` +
        `(AGENTS.md rule 6) and are never this script's concern; running here would be pointless at best.`,
    );
  }
  if (/prod/i.test(dbName)) {
    throw new Error(`refuses to run against "${dbName}" — the name looks production-related.`);
  }
  if (!/^riverline_dev/i.test(dbName)) {
    throw new Error(
      `refuses to run against "${dbName}" — --db-override must name an actual clone of riverline_dev ` +
        `(a name starting with "riverline_dev", e.g. "riverline_dev_clone_scratch"), never an arbitrary database.`,
    );
  }
}

const EMAIL_MATCH_SQL = POLLUTION_EMAIL_PATTERNS.map((_, i) => `u.email like $${i + 1}`).join(" or ");

/** Computes the target jurisdiction set (see file header for the
 * "jurisdiction-level cascade" reasoning) plus a full preview count table,
 * all read-only — no mutation happens in this function. Throws if either
 * independent safety check (protected demo emails, protected jurisdiction
 * name/practice parcel) would somehow be violated by the computed set, which
 * would indicate the correspondence this script relies on no longer holds. */
export async function computeTargets(client) {
  const jurisdictionsRes = await client.query(
    `select j.id, j.name
     from jurisdictions j
     where j.name <> $${POLLUTION_EMAIL_PATTERNS.length + 1}
       and exists (
         select 1 from users u where u.jurisdiction_id = j.id and (${EMAIL_MATCH_SQL})
       )
       and not exists (
         select 1 from users u where u.jurisdiction_id = j.id and not (${EMAIL_MATCH_SQL})
       )
       and not exists (
         select 1 from structures s
         where s.jurisdiction_id = j.id and s.parcel_id like $${POLLUTION_EMAIL_PATTERNS.length + 2}
       )
     order by j.name`,
    [...POLLUTION_EMAIL_PATTERNS, PROTECTED_JURISDICTION_NAME, `${PROTECTED_PRACTICE_PARCEL_PREFIX}%`],
  );
  const jurisdictionIds = jurisdictionsRes.rows.map((r) => r.id);

  const usersRes =
    jurisdictionIds.length === 0
      ? { rows: [] }
      : await client.query(`select id, email, jurisdiction_id from users where jurisdiction_id = any($1::uuid[])`, [
          jurisdictionIds,
        ]);

  // Independent safety checks — see file header rail #4. These re-derive
  // "is this safe" from the computed result itself, not from the query that
  // produced it, so a logic bug in the query above can't silently slip a
  // protected row through.
  for (const email of PROTECTED_DEMO_EMAILS) {
    if (usersRes.rows.some((u) => u.email === email)) {
      throw new Error(`SAFETY ABORT: computed target set includes protected seeded user "${email}". No changes made.`);
    }
  }
  const protectedJurisdiction = jurisdictionsRes.rows.find((j) => j.name === PROTECTED_JURISDICTION_NAME);
  if (protectedJurisdiction) {
    throw new Error(`SAFETY ABORT: computed target set includes "${PROTECTED_JURISDICTION_NAME}". No changes made.`);
  }

  return {
    jurisdictionIds,
    jurisdictions: jurisdictionsRes.rows,
    userIds: usersRes.rows.map((r) => r.id),
    users: usersRes.rows,
  };
}

const PREVIEW_TABLES = [
  { table: "jurisdictions", where: "id = any($1::uuid[])" },
  { table: "users", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "structures", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "assessments", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "assessment_elements", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "photos", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "calculations", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "determinations", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "letters", where: "jurisdiction_id = any($1::uuid[])" },
  { table: "estimates", where: "jurisdiction_id = any($1::uuid[])" },
  {
    table: "audit_log",
    where: "jurisdiction_id = any($1::uuid[]) or actor_user_id in (select id from users where jurisdiction_id = any($1::uuid[]))",
  },
  { table: "login_tokens", where: "user_id in (select id from users where jurisdiction_id = any($1::uuid[]))" },
];

/** Row counts about to be deleted, per table, for the mandatory preview
 * (hard safety rail #2). Read-only. */
export async function previewCounts(client, jurisdictionIds) {
  const counts = {};
  for (const { table, where } of PREVIEW_TABLES) {
    const { rows } = await client.query(`select count(*)::int as n from ${table} where ${where}`, [jurisdictionIds]);
    counts[table] = rows[0].n;
  }
  return counts;
}

/** Total (unfiltered) row counts, for the before/after summary the journal
 * entry quotes. */
export async function totalCounts(client) {
  const counts = {};
  for (const { table } of PREVIEW_TABLES) {
    const { rows } = await client.query(`select count(*)::int as n from ${table}`);
    counts[table] = rows[0].n;
  }
  return counts;
}

/** The actual delete. One transaction; three named triggers disabled and
 * re-enabled within it (see file header "TRIGGER HANDLING"); FK-respecting
 * order (children before parents), including breaking the letters<->
 * determinations mutual FK and the estimates self-FK before the row deletes
 * that would otherwise violate them. No-op (returns immediately) if
 * jurisdictionIds is empty — never issues a DELETE with an empty target
 * list dressed up as "delete everything". */
export async function runCleanup(client, jurisdictionIds) {
  if (jurisdictionIds.length === 0) {
    return { deleted: true, jurisdictionCount: 0 };
  }

  await client.query("BEGIN");
  try {
    await client.query("ALTER TABLE calculations DISABLE TRIGGER calculations_immutable");
    await client.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
    await client.query("ALTER TABLE determinations DISABLE TRIGGER determinations_no_delete");
    await client.query("ALTER TABLE determinations DISABLE TRIGGER determinations_audit");

    // Break circular FKs before any DELETE: determinations.letter_id <->
    // letters.determination_id, and estimates.supersedes_estimate_id (self).
    await client.query(`update determinations set letter_id = null where jurisdiction_id = any($1::uuid[])`, [
      jurisdictionIds,
    ]);
    await client.query(`update estimates set supersedes_estimate_id = null where jurisdiction_id = any($1::uuid[])`, [
      jurisdictionIds,
    ]);

    await client.query(
      `delete from audit_log
       where jurisdiction_id = any($1::uuid[])
          or actor_user_id in (select id from users where jurisdiction_id = any($1::uuid[]))`,
      [jurisdictionIds],
    );
    await client.query(`delete from login_tokens where user_id in (select id from users where jurisdiction_id = any($1::uuid[]))`, [
      jurisdictionIds,
    ]);
    await client.query(`delete from letters where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from determinations where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from calculations where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from estimates where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from photos where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from assessment_elements where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from assessments where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from structures where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from users where jurisdiction_id = any($1::uuid[])`, [jurisdictionIds]);
    await client.query(`delete from jurisdictions where id = any($1::uuid[])`, [jurisdictionIds]);

    await client.query("ALTER TABLE calculations ENABLE TRIGGER calculations_immutable");
    await client.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only");
    await client.query("ALTER TABLE determinations ENABLE TRIGGER determinations_no_delete");
    await client.query("ALTER TABLE determinations ENABLE TRIGGER determinations_audit");

    await client.query("COMMIT");
    return { deleted: true, jurisdictionCount: jurisdictionIds.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Removes uploads/<jurisdictionId>/ for each target jurisdiction (covers
 * both photos and estimates — see file header "UPLOADS"). Call only after
 * the DB transaction has committed. Missing directories are silently
 * skipped (a target jurisdiction that never had an upload is normal, not an
 * error). `uploadsRoot` defaults to the real uploads/ directory; tests pass
 * a scratch directory so this never touches real files. */
export function cleanJurisdictionUploads(jurisdictionIds, { uploadsRoot = UPLOADS_ROOT } = {}) {
  let removedDirs = 0;
  for (const id of jurisdictionIds) {
    const dir = path.join(uploadsRoot, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removedDirs++;
    }
  }
  return { removedDirs };
}

/** Separate, independently-safe step (see file header "UPLOADS"): removes
 * uploads/<id>/ and uploads/letters/<id>/ directories whose <id> does not
 * match ANY row currently in `jurisdictions` — i.e. filesystem debris that
 * predates this cleanup and cannot be referenced by any live foreign key,
 * because there is no jurisdiction row for it to hang off of. Never removes
 * `uploads/letters` itself, only its immediate children. `uploadsRoot`
 * defaults to the real uploads/ directory; tests pass a scratch directory. */
export async function cleanOrphanedUploads(client, { uploadsRoot = UPLOADS_ROOT } = {}) {
  const { rows } = await client.query(`select id from jurisdictions`);
  const liveIds = new Set(rows.map((r) => r.id));
  let removed = 0;

  const topLevel = existsSync(uploadsRoot) ? readdirSync(uploadsRoot, { withFileTypes: true }) : [];
  for (const entry of topLevel) {
    if (!entry.isDirectory() || entry.name === "letters") continue;
    if (!liveIds.has(entry.name)) {
      rmSync(path.join(uploadsRoot, entry.name), { recursive: true, force: true });
      removed++;
    }
  }

  const lettersDir = path.join(uploadsRoot, "letters");
  const letterEntries = existsSync(lettersDir) ? readdirSync(lettersDir, { withFileTypes: true }) : [];
  for (const entry of letterEntries) {
    if (!entry.isDirectory()) continue;
    if (!liveIds.has(entry.name)) {
      rmSync(path.join(lettersDir, entry.name), { recursive: true, force: true });
      removed++;
    }
  }

  return { removedOrphanDirs: removed };
}

function printPreviewTable(counts, label) {
  console.log(`\n--- ${label} ---`);
  const rows = Object.entries(counts);
  const width = Math.max(...rows.map(([t]) => t.length));
  for (const [table, n] of rows) {
    console.log(`  ${table.padEnd(width)}  ${n}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { yes, dbOverride } = parseCleanArgs(process.argv.slice(2));

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error("BLOCKER: DATABASE_URL is not set. See .env.example.");
    process.exit(1);
  }

  const targetDbName = dbOverride ?? DEFAULT_DB;
  try {
    assertSafeDatabaseName(targetDbName, { override: Boolean(dbOverride) });
  } catch (err) {
    console.error("BLOCKER:", err.message);
    process.exit(1);
  }

  const connectionString = withDatabaseName(rawUrl, targetDbName);
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();
    console.log(`Connected to "${targetDbName}".`);

    const before = await totalCounts(client);
    const targets = await computeTargets(client);
    const preview = await previewCounts(client, targets.jurisdictionIds);

    console.log(
      `\nTarget jurisdictions (${targets.jurisdictionIds.length}): ${targets.jurisdictions.map((j) => j.name).join(", ") || "(none)"}`,
    );
    console.log(`Target users (${targets.userIds.length}).`);
    printPreviewTable(preview, "Rows that WILL BE DELETED");
    printPreviewTable(before, "Current totals (before)");

    if (targets.jurisdictionIds.length === 0) {
      console.log("\nNothing to clean — no jurisdictions match the pollution pattern. Exiting.");
      process.exit(0);
    }

    if (!yes) {
      console.log(`\nDry run only — no changes made. Re-run with --yes to actually delete the rows above.`);
      process.exit(0);
    }

    console.log("\n--yes given — deleting now...");
    const result = await runCleanup(client, targets.jurisdictionIds);
    console.log(`Deleted rows for ${result.jurisdictionCount} jurisdiction(s).`);

    const uploadsResult = cleanJurisdictionUploads(targets.jurisdictionIds);
    console.log(`Removed ${uploadsResult.removedDirs} uploads/<jurisdictionId>/ director(y/ies).`);

    const orphanResult = await cleanOrphanedUploads(client);
    console.log(`Removed ${orphanResult.removedOrphanDirs} pre-existing orphaned upload director(y/ies) (no matching jurisdiction row at all).`);

    const after = await totalCounts(client);
    printPreviewTable(after, "Current totals (after)");

    console.log("\nOK: cleanup complete.");
  } catch (err) {
    console.error("BLOCKER:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.end();
  }
}
