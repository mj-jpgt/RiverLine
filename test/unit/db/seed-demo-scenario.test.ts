import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import {
  seedDemoScenario,
  JURISDICTION_NAME,
  EMAIL_DOMAIN,
  COST_TABLE_VERSION,
} from "../../../scripts/db/seed-demo-scenario.mjs";

// Real Postgres, real RLS, no mocks (same discipline as test/unit/db/rls.test.ts).
// Runs against riverline_test only — G2's own instructions ("Idempotent...
// unit test against riverline_test") and AGENTS.md rule 6 (fixtures/seed
// data never lands anywhere but a *_test database from a test file).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. This suite needs a real local Postgres.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");

let admin: pg.Client;

interface TableCounts {
  jurisdictions: number;
  users: number;
  structures: number;
  assessments: number;
  assessmentElements: number;
  calculations: number;
  determinationsByStatus: Record<string, number>;
  letters: number;
}

async function countRows(jurisdictionId: string): Promise<TableCounts> {
  const jurisdictions = await admin.query("select count(*)::int as n from jurisdictions where id = $1", [
    jurisdictionId,
  ]);
  const users = await admin.query("select count(*)::int as n from users where jurisdiction_id = $1", [
    jurisdictionId,
  ]);
  const structures = await admin.query("select count(*)::int as n from structures where jurisdiction_id = $1", [
    jurisdictionId,
  ]);
  const assessments = await admin.query("select count(*)::int as n from assessments where jurisdiction_id = $1", [
    jurisdictionId,
  ]);
  const assessmentElements = await admin.query(
    "select count(*)::int as n from assessment_elements where jurisdiction_id = $1",
    [jurisdictionId],
  );
  const calculations = await admin.query("select count(*)::int as n from calculations where jurisdiction_id = $1", [
    jurisdictionId,
  ]);
  const determinations = await admin.query(
    "select status, count(*)::int as n from determinations where jurisdiction_id = $1 group by status",
    [jurisdictionId],
  );
  const letters = await admin.query("select count(*)::int as n from letters where jurisdiction_id = $1", [
    jurisdictionId,
  ]);

  const determinationsByStatus: Record<string, number> = {};
  for (const row of determinations.rows as { status: string; n: number }[]) {
    determinationsByStatus[row.status] = row.n;
  }

  return {
    jurisdictions: jurisdictions.rows[0].n,
    users: users.rows[0].n,
    structures: structures.rows[0].n,
    assessments: assessments.rows[0].n,
    assessmentElements: assessmentElements.rows[0].n,
    calculations: calculations.rows[0].n,
    determinationsByStatus,
    letters: letters.rows[0].n,
  };
}

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);
  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
});

describe("seed-demo-scenario (T-G2)", () => {
  it(
    "creates the Riverline Training Demo jurisdiction and is idempotent on a second run",
    async () => {
      // Every write this test drives goes through a local ("uploads/") or
      // no-op storage put — never the real Supabase driver — so this test
      // never needs live credentials.
      const writes: string[] = [];
      const storagePut = async (key: string) => {
        writes.push(key);
      };

      const first = await seedDemoScenario(testUrl, { log: () => {}, storagePut });
      expect(first.jurisdictionId).toBeTruthy();

      const jurisdictionRow = await admin.query("select name, ordinance_citation from jurisdictions where id = $1", [
        first.jurisdictionId,
      ]);
      expect(jurisdictionRow.rows[0].name).toBe(JURISDICTION_NAME);
      expect(jurisdictionRow.rows[0].ordinance_citation).toContain("TRAINING SAMPLE");

      const userEmails = await admin.query("select email from users where jurisdiction_id = $1 order by email", [
        first.jurisdictionId,
      ]);
      expect(userEmails.rows.map((r) => r.email as string)).toEqual([
        `demo-admin@${EMAIL_DOMAIN}`,
        `demo-assessor@${EMAIL_DOMAIN}`,
        `demo-official@${EMAIL_DOMAIN}`,
      ]);

      const costTable = await admin.query("select version from cost_tables where version = $1", [
        COST_TABLE_VERSION,
      ]);
      expect(costTable.rows).toHaveLength(1);

      const countsAfterFirstRun = await countRows(first.jurisdictionId);
      expect(countsAfterFirstRun.jurisdictions).toBe(1);
      expect(countsAfterFirstRun.users).toBe(3);
      expect(countsAfterFirstRun.structures).toBe(8);
      expect(countsAfterFirstRun.assessments).toBe(6); // 002..007
      expect(countsAfterFirstRun.calculations).toBe(6); // 003,004,005,006, and 007 x2 (original + superseding)
      expect(countsAfterFirstRun.determinationsByStatus.adopted).toBe(2); // 005, 006
      expect(countsAfterFirstRun.determinationsByStatus.draft).toBe(1); // 007's new draft
      expect(countsAfterFirstRun.determinationsByStatus.superseded).toBe(1); // 007's original
      expect(countsAfterFirstRun.letters).toBe(2); // 005, 006

      // Every calculation's ratio/threshold matches the classification
      // its own numbers imply — never a hand-typed mismatch (the exact
      // failure mode replicating src/core/engine's formula in this script
      // guards against).
      const calcRows = await admin.query(
        "select total_repair_cost, market_value_used, ratio, threshold_result from calculations where jurisdiction_id = $1",
        [first.jurisdictionId],
      );
      for (const row of calcRows.rows as {
        total_repair_cost: string;
        market_value_used: string;
        ratio: string;
        threshold_result: string;
      }[]) {
        const ratio = Number(row.ratio);
        if (row.threshold_result === "SD") expect(ratio).toBeGreaterThanOrEqual(0.55);
        else if (row.threshold_result === "BORDERLINE") {
          expect(ratio).toBeGreaterThanOrEqual(0.45);
          expect(ratio).toBeLessThan(0.55);
        } else expect(ratio).toBeLessThan(0.45);
      }

      // --- Second run: idempotency -----------------------------------------
      const writesAfterFirstRun = writes.length;
      const second = await seedDemoScenario(testUrl, { log: () => {}, storagePut });
      expect(second.jurisdictionId).toBe(first.jurisdictionId);

      const countsAfterSecondRun = await countRows(first.jurisdictionId);
      expect(countsAfterSecondRun).toEqual(countsAfterFirstRun);

      // A true no-op re-run issues no new letters (both already exist).
      expect(writes.length).toBe(writesAfterFirstRun);

      const jurisdictionCount = await admin.query("select count(*)::int as n from jurisdictions where name = $1", [
        JURISDICTION_NAME,
      ]);
      expect(jurisdictionCount.rows[0].n).toBe(1);
    },
    60_000,
  );
});
