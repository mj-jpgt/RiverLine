import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import { withTenant } from "../../../src/shared/db/client";

// Real Postgres, real RLS, no mocks — per docs/agents/SUBAGENT.md "Role:
// data / backend agents" and the T-C1 acceptance check. Runs against
// riverline_test (created + migrated here if it doesn't exist yet), never
// riverline_dev.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error(
    "DATABASE_URL is not set — see .env.example. The RLS suite needs a real local Postgres.",
  );
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");

// The app db client (src/shared/db) reads DATABASE_URL itself (it manages
// its own pool) — point it at riverline_test for the duration of this file.
process.env.DATABASE_URL = testUrl;

let admin: pg.Client; // superuser/owner connection — bypasses RLS by design

interface Jurisdiction {
  id: string;
}
interface TestUser {
  id: string;
  role: string;
}

let jurisdictionA: Jurisdiction;
let jurisdictionB: Jurisdiction;
let userA: TestUser; // official in jurisdiction A, used as the acting app.user_id
let userB: TestUser;
let structureB: { id: string };

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const jA = await admin.query(
    `insert into jurisdictions (name) values ('RLS Test Jurisdiction A') returning id`,
  );
  const jB = await admin.query(
    `insert into jurisdictions (name) values ('RLS Test Jurisdiction B') returning id`,
  );
  jurisdictionA = jA.rows[0];
  jurisdictionB = jB.rows[0];

  const uA = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id, role`,
    [`rls-test-official-a-${Date.now()}@example.gov`, jurisdictionA.id],
  );
  const uB = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id, role`,
    [`rls-test-official-b-${Date.now()}@example.gov`, jurisdictionB.id],
  );
  userA = uA.rows[0];
  userB = uB.rows[0];

  const sB = await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, value_source)
     values ($1, 'RLS-TEST-B-1', '1 Tenant B St', 'appraisal') returning id`,
    [jurisdictionB.id],
  );
  structureB = sB.rows[0];

  // Also give tenant A a structure so cross-tenant reads have a control row.
  await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, value_source)
     values ($1, 'RLS-TEST-A-1', '1 Tenant A St', 'appraisal')`,
    [jurisdictionA.id],
  );
});

afterAll(async () => {
  await admin.end();
});

describe("cross-tenant isolation via the app db client (withTenant)", () => {
  it("tenant A cannot read tenant B's structures", async () => {
    const rows = await withTenant(jurisdictionA.id, userA.id, async (client) => {
      const res = await client.query("select id from structures where jurisdiction_id = $1", [
        jurisdictionB.id,
      ]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant A cannot read tenant B's structures even without a WHERE filter", async () => {
    const rows = await withTenant(jurisdictionA.id, userA.id, async (client) => {
      const res = await client.query("select id from structures");
      return res.rows;
    });
    expect(rows.map((r: { id: string }) => r.id)).not.toContain(structureB.id);
  });

  it("tenant A cannot read tenant B's users", async () => {
    const rows = await withTenant(jurisdictionA.id, userA.id, async (client) => {
      const res = await client.query("select id from users where jurisdiction_id = $1", [
        jurisdictionB.id,
      ]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
    expect(rows.map((r: { id: string }) => r.id)).not.toContain(userB.id);
  });

  it("tenant A CAN read its own structures", async () => {
    const rows = await withTenant(jurisdictionA.id, userA.id, async (client) => {
      const res = await client.query("select id from structures where jurisdiction_id = $1", [
        jurisdictionA.id,
      ]);
      return res.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("calculations are immutable (insert-only)", () => {
  it("rejects UPDATE and DELETE via the app client", async () => {
    const { assessmentId, calculationId } = await withTenant(
      jurisdictionA.id,
      userA.id,
      async (client) => {
        const structure = await client.query(
          "select id from structures where jurisdiction_id = $1 limit 1",
          [jurisdictionA.id],
        );
        const assessment = await client.query(
          `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id)
           values ($1, $2, $3, $4) returning id`,
          [structure.rows[0].id, jurisdictionA.id, userA.id, `rls-test-client-${Date.now()}`],
        );
        const calc = await client.query(
          `insert into calculations (
             assessment_id, jurisdiction_id, cost_table_version, total_repair_cost,
             market_value_used, value_source, ratio, threshold_result, engine_version
           ) values ($1, $2, 'TEST-FIXTURE-v0', 1000, 100000, 'appraisal', 0.01, 'NOT_SD', 'test-0')
           returning id`,
          [assessment.rows[0].id, jurisdictionA.id],
        );
        return { assessmentId: assessment.rows[0].id, calculationId: calc.rows[0].id };
      },
    );

    await expect(
      withTenant(jurisdictionA.id, userA.id, (client) =>
        client.query("update calculations set total_repair_cost = 999999 where id = $1", [
          calculationId,
        ]),
      ),
    ).rejects.toThrow(/immutable/i);

    await expect(
      withTenant(jurisdictionA.id, userA.id, (client) =>
        client.query("delete from calculations where id = $1", [calculationId]),
      ),
    ).rejects.toThrow(/immutable/i);

    void assessmentId;
  });
});

describe("determinations are never deleted, and every mutation is audited", () => {
  it("rejects DELETE", async () => {
    const determinationId = await createDraftDetermination();

    await expect(
      withTenant(jurisdictionA.id, userA.id, (client) =>
        client.query("delete from determinations where id = $1", [determinationId]),
      ),
    ).rejects.toThrow(/never deleted/i);
  });

  it("writes an audit_log row on UPDATE", async () => {
    const determinationId = await createDraftDetermination();

    const before = await withTenant(jurisdictionA.id, userA.id, async (client) => {
      const res = await client.query(
        "select count(*)::int as n from audit_log where entity_type = 'determination' and entity_id = $1",
        [determinationId],
      );
      return res.rows[0].n as number;
    });

    await withTenant(jurisdictionA.id, userA.id, (client) =>
      client.query(
        `update determinations set status = 'adopted', adopted_by_user_id = $2, adopted_at = now() where id = $1`,
        [determinationId, userA.id],
      ),
    );

    const after = await withTenant(jurisdictionA.id, userA.id, async (client) => {
      const res = await client.query(
        "select actor_user_id, action from audit_log where entity_type = 'determination' and entity_id = $1 order by at desc",
        [determinationId],
      );
      return res.rows;
    });

    expect(after.length).toBeGreaterThan(before);
    expect(after[0].action).toBe("UPDATE");
    expect(after[0].actor_user_id).toBe(userA.id);
  });
});

async function createDraftDetermination(): Promise<string> {
  return withTenant(jurisdictionA.id, userA.id, async (client) => {
    const structure = await client.query(
      "select id from structures where jurisdiction_id = $1 limit 1",
      [jurisdictionA.id],
    );
    const assessment = await client.query(
      `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id)
       values ($1, $2, $3, $4) returning id`,
      [structure.rows[0].id, jurisdictionA.id, userA.id, `rls-test-client-${Date.now()}-${Math.random()}`],
    );
    const calc = await client.query(
      `insert into calculations (
         assessment_id, jurisdiction_id, cost_table_version, total_repair_cost,
         market_value_used, value_source, ratio, threshold_result, engine_version
       ) values ($1, $2, 'TEST-FIXTURE-v0', 1000, 100000, 'appraisal', 0.01, 'NOT_SD', 'test-0')
       returning id`,
      [assessment.rows[0].id, jurisdictionA.id],
    );
    const determination = await client.query(
      `insert into determinations (structure_id, jurisdiction_id, calculation_id)
       values ($1, $2, $3) returning id`,
      [structure.rows[0].id, jurisdictionA.id, calc.rows[0].id],
    );
    return determination.rows[0].id as string;
  });
}
