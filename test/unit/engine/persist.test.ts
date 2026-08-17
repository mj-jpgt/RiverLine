import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import { withTenant } from "../../../src/shared/db/client";
import { computeAndPersistCalculation, getLatestCalculationView } from "../../../app/calculation/_lib/compute";
import costTableFixture from "../../fixtures/engine/cost-table.test-fixture-v0.json";

// Real Postgres, real db writes, no mocks — proves the T-C4 persistence
// wiring end to end: insert-only calculations, correct stamps, and
// reproducible re-run. Runs against riverline_test only (AGENTS.md rule 6:
// "Mock/fixture data lives only in test/fixtures/ and seeds only databases
// named *_test"). The TEST cost table is seeded here, in test setup, from
// test/fixtures/engine/cost-table.test-fixture-v0.json — never via the dev
// seed script (scripts/db/seed.mjs never touches cost_tables at all, so
// riverline_dev legitimately has none — the honest "no cost table loaded"
// state per specs/constitution.md §2).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The engine persistence suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionId: string;
let userId: string;
let structureId: string;
let seededCostTableVersion: string;
const clientId = `engine-persist-test-${Date.now()}`;

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const j = await admin.query(
    `insert into jurisdictions (name) values ('Engine Persist Test Jurisdiction') returning id`,
  );
  jurisdictionId = j.rows[0].id;

  // Seed the TEST cost table (test-setup-only path, never scripts/db/seed.mjs),
  // scoped to THIS test jurisdiction rather than global (jurisdiction_id
  // null) — a global row would make "no cost table loaded" untestable for
  // any jurisdiction in this shared riverline_test database. `version` is
  // globally unique per schema/core.sql, so scope it to this test run's
  // jurisdiction id to avoid colliding with any other test file's seed.
  seededCostTableVersion = `${costTableFixture.version}-${jurisdictionId}`;
  await admin.query(
    `insert into cost_tables (version, jurisdiction_id, source_citation, effective_date, json_payload)
     values ($1, $2, $3, $4, $5)
     on conflict (version) do nothing`,
    [
      seededCostTableVersion,
      jurisdictionId,
      costTableFixture.source_citation,
      costTableFixture.effective_date,
      JSON.stringify({ base_cost_per_sqft: costTableFixture.base_cost_per_sqft }),
    ],
  );

  const u = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor') returning id`,
    [`engine-persist-test-${Date.now()}@example.gov`, jurisdictionId],
  );
  userId = u.rows[0].id;

  const s = await admin.query(
    `insert into structures (
       jurisdiction_id, parcel_id, address, assessor_market_value, improvement_value,
       value_source, occupancy_type, sq_ft
     ) values ($1, 'ENGINE-PERSIST-1', '1 Engine Persist St', 200000, 150000, 'appraisal', 'residential', 1000)
     returning id`,
    [jurisdictionId],
  );
  structureId = s.rows[0].id;

  const a = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id)
     values ($1, $2, $3, $4) returning id`,
    [structureId, jurisdictionId, userId, clientId],
  );
  const assessmentId = a.rows[0].id;

  // G3-shaped damage from the golden fixtures: total_repair_cost 39250,
  // ratio 39250/200000 = 0.19625 -> NOT_SD. Not asserted against the
  // golden fixture directly (this is a persistence test, not a re-run of
  // golden.test.ts) but reuses real, known-correct arithmetic.
  const damage: Record<string, number> = {
    foundations: 25,
    superstructure: 50,
    roof_covering: 100,
    interior_finish: 75,
    floor_finish: 50,
    plumbing: 25,
    electrical: 25,
  };
  for (const [code, pct] of Object.entries(damage)) {
    await admin.query(
      `insert into assessment_elements (assessment_id, jurisdiction_id, element_code, damage_pct, cost_table_version)
       values ($1, $2, $3, $4, 'NONE')`,
      [assessmentId, jurisdictionId, code, pct],
    );
  }
});

afterAll(async () => {
  await admin.end();
});

describe("computeAndPersistCalculation — real Postgres, insert-only", () => {
  it("computes and inserts a calculations row stamped with cost_table_version, engine_version, market_value_used, value_source", async () => {
    const result = await computeAndPersistCalculation(jurisdictionId, userId, clientId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");

    expect(result.calculation.costTableVersion).toBe(seededCostTableVersion);
    expect(result.calculation.engineVersion).toBe("1.0.0");
    expect(result.calculation.marketValueUsed).toBe(200000); // assessor_market_value, not improvement_value
    expect(result.calculation.valueSource).toBe("appraisal");
    expect(result.calculation.totalRepairCost).toBe(39250);
    expect(result.calculation.ratio).toBe(0.1963); // 39250/200000 = 0.19625 -> half-up 0.1963
    expect(result.calculation.thresholdResult).toBe("NOT_SD");
    expect(result.priorCalculationCount).toBe(0);
    expect(result.elements.length).toBe(12); // full residential breakdown
  });

  it("a re-run inserts a SECOND row — both remain, never an UPDATE", async () => {
    const before = await admin.query(
      `select count(*)::int as n from calculations c join assessments a on a.id = c.assessment_id where a.client_id = $1`,
      [clientId],
    );
    const beforeCount = before.rows[0].n as number;

    const result = await computeAndPersistCalculation(jurisdictionId, userId, clientId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.priorCalculationCount).toBe(beforeCount);

    const after = await admin.query(
      `select count(*)::int as n from calculations c join assessments a on a.id = c.assessment_id where a.client_id = $1`,
      [clientId],
    );
    expect(after.rows[0].n).toBe(beforeCount + 1);

    // Both rows are distinct and both remain queryable.
    const all = await admin.query(
      `select c.id from calculations c join assessments a on a.id = c.assessment_id where a.client_id = $1 order by computed_at`,
      [clientId],
    );
    const ids = new Set(all.rows.map((r: { id: string }) => r.id));
    expect(ids.size).toBe(after.rows[0].n);
  });

  it("UPDATE on a calculation row produced via this path still raises (immutability holds through the app's own insert path)", async () => {
    const latest = await admin.query(
      `select c.id from calculations c join assessments a on a.id = c.assessment_id
       where a.client_id = $1 order by computed_at desc limit 1`,
      [clientId],
    );
    const calculationId = latest.rows[0].id as string;

    await expect(
      withTenant(jurisdictionId, userId, (client) =>
        client.query("update calculations set total_repair_cost = 1 where id = $1", [calculationId]),
      ),
    ).rejects.toThrow(/immutable/i);

    await expect(
      withTenant(jurisdictionId, userId, (client) => client.query("delete from calculations where id = $1", [calculationId])),
    ).rejects.toThrow(/immutable/i);
  });

  it("getLatestCalculationView reconstructs the same per-element breakdown by re-running the engine against the stamped cost_table_version", async () => {
    const view = await getLatestCalculationView(jurisdictionId, userId, clientId);
    expect(view.status).toBe("has_calculation");
    if (view.status !== "has_calculation") throw new Error("expected has_calculation");
    expect(view.elements.length).toBe(12);
    expect(view.calculation.totalRepairCost).toBe(39250);
    expect(view.priorCalculationCount).toBeGreaterThanOrEqual(1);
  });
});

describe("computeAndPersistCalculation — explicit honest states, never a fabricated figure", () => {
  it("returns no_cost_table (never computes) when the jurisdiction has none", async () => {
    const noTableJurisdiction = await admin.query(
      `insert into jurisdictions (name) values ('No Cost Table Test Jurisdiction') returning id`,
    );
    const jId = noTableJurisdiction.rows[0].id;
    const u = await admin.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor') returning id`, [
      `no-cost-table-test-${Date.now()}@example.gov`,
      jId,
    ]);
    const s = await admin.query(
      `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft)
       values ($1, 'NO-COST-TABLE-1', '2 No Cost Table St', 100000, 'appraisal', 'residential', 1000) returning id`,
      [jId],
    );
    const cid = `no-cost-table-test-${Date.now()}`;
    await admin.query(
      `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id) values ($1, $2, $3, $4)`,
      [s.rows[0].id, jId, u.rows[0].id, cid],
    );

    const result = await computeAndPersistCalculation(jId, u.rows[0].id, cid);
    expect(result.status).toBe("no_cost_table");

    const count = await admin.query(
      `select count(*)::int as n from calculations c join assessments a on a.id = c.assessment_id where a.client_id = $1`,
      [cid],
    );
    expect(count.rows[0].n).toBe(0);
  });

  it("returns no_value (never computes) when neither assessor_market_value nor improvement_value is set", async () => {
    const s = await admin.query(
      `insert into structures (jurisdiction_id, parcel_id, address, value_source, occupancy_type, sq_ft)
       values ($1, 'NO-VALUE-1', '3 No Value St', 'appraisal', 'residential', 1000) returning id`,
      [jurisdictionId],
    );
    const cid = `no-value-test-${Date.now()}`;
    await admin.query(
      `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id) values ($1, $2, $3, $4)`,
      [s.rows[0].id, jurisdictionId, userId, cid],
    );

    const result = await computeAndPersistCalculation(jurisdictionId, userId, cid);
    expect(result.status).toBe("no_value");

    const count = await admin.query(
      `select count(*)::int as n from calculations c join assessments a on a.id = c.assessment_id where a.client_id = $1`,
      [cid],
    );
    expect(count.rows[0].n).toBe(0);
  });
});
