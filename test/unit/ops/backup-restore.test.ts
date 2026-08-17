import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runPgDump, writeBackup, backupTimestamp, DB_BACKUP_DATABASE } from "../../../scripts/ops/backup.mjs";
import { recreateDatabase, runPsqlRestore, DB_CONTAINER, DB_BACKUP_USER } from "../../../scripts/ops/restore.mjs";
import { withDatabaseName } from "../../../scripts/db/ensure-database.mjs";

// T-C6 backup/restore proof (specs/core/tasks.md). Real pg_dump of the real
// riverline_dev database (docker exec riverline-db-1 pg_dump — no local
// pg_dump/psql on this machine, see scripts/ops/backup.mjs's header),
// restored into a disposable scratch database, then verified against the
// SOURCE database (never against the dump text) via real Postgres queries:
// - structures row count matches, exactly.
// - one real, known structure row (the T-C1 seed's practice structure,
//   "123 Practice Ln" / DEMO-PRACTICE-001 — always present in riverline_dev)
//   survives with every column byte-identical.
// No mocks anywhere in this chain: real docker container, real pg_dump/psql
// binaries, real filesystem write under backups/ (gitignored).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. This test needs the real riverline_dev database.");
}

const SCRATCH_DB = "riverline_restore_check_test";
const PRACTICE_ADDRESS = "123 Practice Ln";

let backupFilePath: string;
let devClient: pg.Client;
let scratchClient: pg.Client;

describe("T-C6: pnpm db:backup / pnpm db:restore — real restore proof", () => {
  beforeAll(async () => {
    // 1. Real pg_dump of the real dev database.
    const sql = runPgDump(DB_CONTAINER, DB_BACKUP_USER, DB_BACKUP_DATABASE);
    backupFilePath = writeBackup(sql, `test-${backupTimestamp()}`);

    // 2. Restore it into a disposable scratch database (never riverline_dev).
    await recreateDatabase(baseUrl, SCRATCH_DB);
    runPsqlRestore(DB_CONTAINER, DB_BACKUP_USER, SCRATCH_DB, backupFilePath);

    // Connect directly (superuser, no RLS/withTenant — this test verifies raw
    // storage fidelity, not application-level access control, which is
    // already covered by test/unit/db/rls.test.ts).
    devClient = new pg.Client({ connectionString: withDatabaseName(baseUrl, DB_BACKUP_DATABASE) });
    scratchClient = new pg.Client({ connectionString: withDatabaseName(baseUrl, SCRATCH_DB) });
    await devClient.connect();
    await scratchClient.connect();
  }, 60_000);

  afterAll(async () => {
    await devClient?.end();
    await scratchClient?.end();
    // Drop the scratch database so repeated test runs don't accumulate them
    // (recreateDatabase would also do this on the next run, but clean up
    // proactively rather than leaving it dangling if the suite is never run
    // again).
    const admin = new pg.Client({ connectionString: withDatabaseName(baseUrl!, "postgres") });
    await admin.connect();
    try {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
        [SCRATCH_DB],
      );
      await admin.query(`drop database if exists "${SCRATCH_DB}"`);
    } finally {
      await admin.end();
    }
  });

  it("structures row count in the restored scratch db matches the source db exactly", async () => {
    const devCount = await devClient.query("select count(*)::int as n from structures");
    const scratchCount = await scratchClient.query("select count(*)::int as n from structures");
    expect(devCount.rows[0].n).toBeGreaterThan(0); // sanity: real ingested data, not an empty db
    expect(scratchCount.rows[0].n).toBe(devCount.rows[0].n);
  });

  it("a sampled real structure row survives the backup/restore round-trip byte-identical", async () => {
    const devRow = await devClient.query(
      `select id, jurisdiction_id, parcel_id, address, assessor_market_value, improvement_value,
              value_source, value_as_of_date, sfha_zone, firm_panel, occupancy_type,
              foundation_type, stories, sq_ft, year_built, prop_class, created_at
       from structures where address = $1`,
      [PRACTICE_ADDRESS],
    );
    expect(devRow.rows.length).toBe(1);

    const scratchRow = await scratchClient.query(
      `select id, jurisdiction_id, parcel_id, address, assessor_market_value, improvement_value,
              value_source, value_as_of_date, sfha_zone, firm_panel, occupancy_type,
              foundation_type, stories, sq_ft, year_built, prop_class, created_at
       from structures where address = $1`,
      [PRACTICE_ADDRESS],
    );
    expect(scratchRow.rows.length).toBe(1);

    // Byte-identical: every column, not just address + parcel_id, though
    // those two are the task's explicitly named minimum.
    expect(scratchRow.rows[0]).toEqual(devRow.rows[0]);
    expect(scratchRow.rows[0].address).toBe(PRACTICE_ADDRESS);
    expect(scratchRow.rows[0].parcel_id).toBe("DEMO-PRACTICE-001");
  });

  it("other core tables also round-trip with matching row counts (not just structures)", async () => {
    for (const table of ["jurisdictions", "users", "assessments", "assessment_elements"]) {
      const devCount = await devClient.query(`select count(*)::int as n from ${table}`);
      const scratchCount = await scratchClient.query(`select count(*)::int as n from ${table}`);
      expect(scratchCount.rows[0].n).toBe(devCount.rows[0].n);
    }
  });
});
