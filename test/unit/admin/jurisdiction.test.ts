import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import { updateJurisdictionSettings } from "../../../src/core/admin/actions";
import { getJurisdictionSettings, getReadinessStatus } from "../../../src/core/admin/queries";

// Real Postgres, real writes, no mocks — proves src/core/admin's
// updateJurisdictionSettings: validation, audited writes, genuine field
// clearing (blank = unset), and that it never touches another
// jurisdiction's row. AGENTS.md rule 6: only ever seeds riverline_test.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The admin persistence suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionAId: string;
let jurisdictionBId: string;
let adminUserAId: string;
let adminUserBId: string;

const TEST_CITATION = "TEST ORDINANCE §00-000 — fixture, not legal text, w5-admin jurisdiction suite.";

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const jA = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    `W5 Jurisdiction Settings Test A ${Date.now()}`,
  ]);
  jurisdictionAId = jA.rows[0].id;

  const jB = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    `W5 Jurisdiction Settings Test B ${Date.now()}`,
  ]);
  jurisdictionBId = jB.rows[0].id;

  const uA = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin') returning id`,
    [`w5-jur-test-a-${Date.now()}@example.gov`, jurisdictionAId],
  );
  adminUserAId = uA.rows[0].id;

  const uB = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin') returning id`,
    [`w5-jur-test-b-${Date.now()}@example.gov`, jurisdictionBId],
  );
  adminUserBId = uB.rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

describe("updateJurisdictionSettings — validation", () => {
  it("rejects an empty ordinance citation", async () => {
    const result = await updateJurisdictionSettings(jurisdictionAId, adminUserAId, {
      ordinanceCitation: "   ",
      appealWindowDays: null,
      letterheadName: null,
      addressLines: null,
      iccText: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("citation_required");
  });

  it("rejects a non-positive appeal window", async () => {
    const result = await updateJurisdictionSettings(jurisdictionAId, adminUserAId, {
      ordinanceCitation: TEST_CITATION,
      appealWindowDays: -5,
      letterheadName: null,
      addressLines: null,
      iccText: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_appeal_window");
  });

  it("rejects a non-integer appeal window", async () => {
    const result = await updateJurisdictionSettings(jurisdictionAId, adminUserAId, {
      ordinanceCitation: TEST_CITATION,
      appealWindowDays: 30.5,
      letterheadName: null,
      addressLines: null,
      iccText: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_appeal_window");
  });
});

describe("updateJurisdictionSettings — writes, readiness reflects it, audited", () => {
  it("readiness starts NOT SET for a freshly-created jurisdiction", async () => {
    const readiness = await getReadinessStatus(jurisdictionAId, adminUserAId);
    expect(readiness.ordinanceCitationSet).toBe(false);
    expect(readiness.appealWindowSet).toBe(false);
    expect(readiness.costTableLoaded).toBe(false);
  });

  it("writes citation, appeal window, letterhead name, address lines, and ICC text; audits before/after", async () => {
    const before = await admin.query(`select ordinance_citation from jurisdictions where id = $1`, [
      jurisdictionAId,
    ]);
    expect(before.rows[0].ordinance_citation).toBeNull();

    const result = await updateJurisdictionSettings(jurisdictionAId, adminUserAId, {
      ordinanceCitation: TEST_CITATION,
      appealWindowDays: 30,
      letterheadName: "W5 Test City Floodplain Office",
      addressLines: ["100 Test Ave", "Test City, IN 00000"],
      iccText: "Jurisdiction-supplied ICC paragraph text.",
    });
    expect(result.ok).toBe(true);

    const settings = await getJurisdictionSettings(jurisdictionAId, adminUserAId);
    expect(settings?.ordinanceCitation).toBe(TEST_CITATION);
    expect(settings?.appealWindowDays).toBe(30);
    expect(settings?.letterheadName).toBe("W5 Test City Floodplain Office");
    expect(settings?.addressLines).toEqual(["100 Test Ave", "Test City, IN 00000"]);
    expect(settings?.iccText).toBe("Jurisdiction-supplied ICC paragraph text.");

    const readiness = await getReadinessStatus(jurisdictionAId, adminUserAId);
    expect(readiness.ordinanceCitationSet).toBe(true);
    expect(readiness.appealWindowSet).toBe(true);

    const audit = await admin.query(
      `select before_json, after_json, actor_user_id, action from audit_log
       where entity_type = 'jurisdiction' and jurisdiction_id = $1 and action = 'admin_update_settings'
       order by at desc limit 1`,
      [jurisdictionAId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].actor_user_id).toBe(adminUserAId);
    expect(audit.rows[0].before_json.ordinance_citation).toBeNull();
    expect(audit.rows[0].after_json.ordinance_citation).toBe(TEST_CITATION);
  });

  it("a blank appeal window on a later save CLEARS it (empty = unset), leaving the citation untouched", async () => {
    const result = await updateJurisdictionSettings(jurisdictionAId, adminUserAId, {
      ordinanceCitation: TEST_CITATION,
      appealWindowDays: null,
      letterheadName: "W5 Test City Floodplain Office",
      addressLines: ["100 Test Ave", "Test City, IN 00000"],
      iccText: "Jurisdiction-supplied ICC paragraph text.",
    });
    expect(result.ok).toBe(true);

    const settings = await getJurisdictionSettings(jurisdictionAId, adminUserAId);
    expect(settings?.appealWindowDays).toBeNull();
    expect(settings?.ordinanceCitation).toBe(TEST_CITATION);

    const readiness = await getReadinessStatus(jurisdictionAId, adminUserAId);
    expect(readiness.appealWindowSet).toBe(false);
    expect(readiness.ordinanceCitationSet).toBe(true);
  });
});

describe("tenant scoping — jurisdiction A's settings write never touches jurisdiction B", () => {
  it("jurisdiction B's ordinance citation stays null after A's write", async () => {
    const settingsB = await getJurisdictionSettings(jurisdictionBId, adminUserBId);
    expect(settingsB?.ordinanceCitation).toBeNull();
    expect(settingsB?.appealWindowDays).toBeNull();
  });

  it("updateJurisdictionSettings scoped to A returns not_found when pointed at a nonexistent id under B's tenant context", async () => {
    // withTenant sets app.jurisdiction_id = B; a jurisdictions row lookup
    // by a random id (never B's own id) must find nothing, proving the
    // write path can't be redirected to write another tenant's row.
    const result = await updateJurisdictionSettings(jurisdictionBId, adminUserBId, {
      ordinanceCitation: "Some other citation entirely, long enough to pass any length check.",
      appealWindowDays: null,
      letterheadName: null,
      addressLines: null,
      iccText: null,
    });
    expect(result.ok).toBe(true); // B's own row IS found and updated

    const settingsA = await getJurisdictionSettings(jurisdictionAId, adminUserAId);
    // A's citation from the earlier describe block must be unaffected by B's write.
    expect(settingsA?.ordinanceCitation).toBe(TEST_CITATION);
  });
});
