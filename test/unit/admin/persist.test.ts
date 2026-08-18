import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import { insertCostTable } from "../../../src/core/admin/actions";
import { getCostTables as getCostTablesQuery, getActiveCostTableVersion } from "../../../src/core/admin/queries";
import { requireRole, AuthError } from "../../../src/core/auth/role-guard";
import type { SessionPayload } from "../../../src/core/auth/session";
import { runEngine } from "../../../src/core/engine";
import type { EngineCostTable } from "../../../src/core/engine";

// Real Postgres, real writes, no mocks — proves T-W5's core invariant: the
// admin cost-table screen is the only real (non-test-harness) code path
// that can ever populate cost_tables, and every row it writes is one the
// actual 50%-rule engine can consume without modification.
//
// This module has no route-level HTTP test for the 403 path — same
// documented precedent as test/unit/modules/a3/export-integration.test.ts
// and test/unit/modules/a1/persist.test.ts: cookies()/next/headers require
// a real request context nothing else in this codebase unit-tests
// directly. requireRole (the exact function
// app/api/admin/cost-tables/route.ts and app/api/admin/jurisdiction/
// route.ts both call first) is exercised directly below with a
// non-admin session, proving the 403 path the routes delegate to; the full
// HTTP 403 is proven end-to-end by test/e2e/admin.spec.ts.
// AGENTS.md rule 6: this suite only ever seeds riverline_test.

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

function uniqueVersion(label: string): string {
  return `w5-admin-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const FULL_RESIDENTIAL_PAYLOAD: Record<string, number> = {
  foundations: 10,
  superstructure: 20,
  roof_covering: 8,
  exterior_finish: 6,
  interior_finish: 12,
  doors_windows: 7,
  cabinets_countertops: 5,
  floor_finish: 9,
  plumbing: 11,
  electrical: 10,
  appliances: 4,
  hvac: 8,
};

const FULL_NON_RESIDENTIAL_PAYLOAD: Record<string, number> = {
  foundations: 12,
  superstructure: 25,
  roof_covering: 9,
  plumbing: 10,
  electrical: 11,
  interiors: 14,
  hvac: 9,
};

const VALID_CITATION = "Marshall & Swift Residential Cost Handbook, 2026 ed., p. 42 — jurisdiction-selected guide.";

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const jA = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    `W5 Admin Test Jurisdiction A ${Date.now()}`,
  ]);
  jurisdictionAId = jA.rows[0].id;

  const jB = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    `W5 Admin Test Jurisdiction B ${Date.now()}`,
  ]);
  jurisdictionBId = jB.rows[0].id;

  const uA = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin') returning id`,
    [`w5-admin-test-a-${Date.now()}@example.gov`, jurisdictionAId],
  );
  adminUserAId = uA.rows[0].id;

  const uB = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin') returning id`,
    [`w5-admin-test-b-${Date.now()}@example.gov`, jurisdictionBId],
  );
  adminUserBId = uB.rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

describe("insertCostTable — validation, before any DB write", () => {
  it("rejects an empty source citation", async () => {
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version: uniqueVersion("empty-citation"),
      sourceCitation: "   ",
      effectiveDateIso: "2026-08-17",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("citation_required");
  });

  it("rejects a source citation that is too short to be a real source (placeholder guard)", async () => {
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version: uniqueVersion("short-citation"),
      sourceCitation: "n/a",
      effectiveDateIso: "2026-08-17",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("citation_too_short");
  });

  it("rejects a missing version label", async () => {
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version: "   ",
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-17",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("version_required");
  });

  it("rejects an invalid effective date", async () => {
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version: uniqueVersion("bad-date"),
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "not-a-date",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("effective_date_invalid");
  });

  it("rejects a payload missing a required residential element code, with a per-field message", async () => {
    const { foundations: _drop, ...missingFoundations } = FULL_RESIDENTIAL_PAYLOAD;
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version: uniqueVersion("missing-element"),
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-17",
      payload: { residential: missingFoundations, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("payload_invalid");
      expect(result.fieldErrors?.some((f) => f.includes("foundations"))).toBe(true);
    }
  });

  it("rejects a payload with an extra, unrecognized element code", async () => {
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version: uniqueVersion("extra-element"),
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-17",
      payload: {
        residential: { ...FULL_RESIDENTIAL_PAYLOAD, made_up_element: 5 },
        non_residential: FULL_NON_RESIDENTIAL_PAYLOAD,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("payload_invalid");
  });

  it("rejects a payload with a non-numeric element value", async () => {
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version: uniqueVersion("nan-element"),
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-17",
      payload: {
        residential: { ...FULL_RESIDENTIAL_PAYLOAD, foundations: Number.NaN },
        non_residential: FULL_NON_RESIDENTIAL_PAYLOAD,
      },
    });
    expect(result.ok).toBe(false);
  });

  it("none of the rejected attempts above wrote a cost_tables or audit_log row", async () => {
    const ct = await admin.query(`select count(*)::int as n from cost_tables where jurisdiction_id = $1`, [
      jurisdictionAId,
    ]);
    expect(ct.rows[0].n).toBe(0);
    const al = await admin.query(
      `select count(*)::int as n from audit_log where jurisdiction_id = $1 and entity_type = 'cost_table'`,
      [jurisdictionAId],
    );
    expect(al.rows[0].n).toBe(0);
  });
});

describe("insertCostTable — a valid full payload, and round-trip through the real engine", () => {
  it("accepts a valid full payload, writes one row, audits it, and becomes the ACTIVE table", async () => {
    const version = uniqueVersion("valid");
    const before = await admin.query(`select count(*)::int as n from cost_tables where jurisdiction_id = $1`, [
      jurisdictionAId,
    ]);

    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version,
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-17",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.version).toBe(version);

    const after = await admin.query(`select count(*)::int as n from cost_tables where jurisdiction_id = $1`, [
      jurisdictionAId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);

    const row = await admin.query(
      `select version, jurisdiction_id, source_citation, effective_date, json_payload from cost_tables where version = $1`,
      [version],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].jurisdiction_id).toBe(jurisdictionAId);
    expect(row.rows[0].source_citation).toBe(VALID_CITATION);

    const audit = await admin.query(
      `select actor_user_id, action, after_json from audit_log where entity_type = 'cost_table' and jurisdiction_id = $1 order by at desc limit 1`,
      [jurisdictionAId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].actor_user_id).toBe(adminUserAId);
    expect(audit.rows[0].action).toBe("insert");
    expect(audit.rows[0].after_json.version).toBe(version);

    const activeVersion = await getActiveCostTableVersion(jurisdictionAId, adminUserAId);
    expect(activeVersion).toBe(version);
  });

  it("a second insert with the same version label is rejected (version_exists), never silently overwrites", async () => {
    const version = uniqueVersion("dup");
    const first = await insertCostTable(jurisdictionAId, adminUserAId, {
      version,
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-17",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(first.ok).toBe(true);

    const second = await insertCostTable(jurisdictionAId, adminUserAId, {
      version,
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-18",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("version_exists");
  });

  it("inserting a second, later-effective table supersedes the first as ACTIVE, but the first row is never deleted", async () => {
    const olderVersion = uniqueVersion("older");
    const newerVersion = uniqueVersion("newer");

    await insertCostTable(jurisdictionAId, adminUserAId, {
      version: olderVersion,
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2020-01-01",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    await insertCostTable(jurisdictionAId, adminUserAId, {
      version: newerVersion,
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2030-01-01",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });

    const activeVersion = await getActiveCostTableVersion(jurisdictionAId, adminUserAId);
    expect(activeVersion).toBe(newerVersion);

    const older = await admin.query(`select version from cost_tables where version = $1`, [olderVersion]);
    expect(older.rows.length).toBe(1); // still on file — versioned history, never deleted

    const list = await getCostTablesQuery(jurisdictionAId, adminUserAId);
    const olderRow = list.find((r) => r.version === olderVersion);
    const newerRow = list.find((r) => r.version === newerVersion);
    expect(olderRow?.isActive).toBe(false);
    expect(newerRow?.isActive).toBe(true);
  });

  it("the stored row's payload round-trips through the real engine (runEngine) without modification", async () => {
    const version = uniqueVersion("engine-roundtrip");
    const result = await insertCostTable(jurisdictionAId, adminUserAId, {
      version,
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2026-08-17",
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });
    expect(result.ok).toBe(true);

    const row = await admin.query(`select version, json_payload from cost_tables where version = $1`, [version]);
    const storedCostTable: EngineCostTable = {
      version: row.rows[0].version as string,
      base_cost_per_sqft: (row.rows[0].json_payload as { base_cost_per_sqft: EngineCostTable["base_cost_per_sqft"] })
        .base_cost_per_sqft,
    };

    const engineResult = runEngine({
      occupancy: "residential",
      sq_ft: 1000,
      market_value_used: 200000,
      damage: { foundations: 100, superstructure: 100 },
      cost_table: storedCostTable,
    });

    // foundations: 10 $/sqft * 1000 sqft * 100% = 10000; superstructure: 20 * 1000 * 100% = 20000
    expect(engineResult.total_repair_cost).toBe(30000);
    expect(engineResult.elements.length).toBe(12); // full residential breakdown, per EngineOutput contract
    expect(engineResult.ratio).toBeCloseTo(0.15, 4);
    expect(engineResult.threshold_result).toBe("NOT_SD");
  });
});

describe("tenant scoping — jurisdiction A's cost table is invisible to jurisdiction B", () => {
  it("a jurisdiction-scoped cost table does not appear in another jurisdiction's list or active lookup", async () => {
    const version = uniqueVersion("tenant-scoped");
    await insertCostTable(jurisdictionAId, adminUserAId, {
      version,
      sourceCitation: VALID_CITATION,
      effectiveDateIso: "2099-01-01", // far future, would win any tie-break if visible
      payload: { residential: FULL_RESIDENTIAL_PAYLOAD, non_residential: FULL_NON_RESIDENTIAL_PAYLOAD },
    });

    const listForB = await getCostTablesQuery(jurisdictionBId, adminUserBId);
    expect(listForB.some((r) => r.version === version)).toBe(false);

    const activeForB = await getActiveCostTableVersion(jurisdictionBId, adminUserBId);
    expect(activeForB).not.toBe(version);
  });
});

describe("role guard — the exact function the admin API routes call first", () => {
  it("requireRole throws AuthError (FORBIDDEN) for a non-admin session, the 403 path both admin routes delegate to", () => {
    const assessorSession: SessionPayload = {
      userId: "irrelevant",
      jurisdictionId: jurisdictionAId,
      role: "assessor",
      email: "assessor@example.gov",
      iat: 0,
      exp: Number.MAX_SAFE_INTEGER,
    };
    expect(() => requireRole(assessorSession, ["admin"])).toThrow(AuthError);
    try {
      requireRole(assessorSession, ["admin"]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("FORBIDDEN");
    }
  });

  it("requireRole throws AuthError (UNAUTHENTICATED) with no session", () => {
    expect(() => requireRole(null, ["admin"])).toThrow(AuthError);
    try {
      requireRole(null, ["admin"]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("UNAUTHENTICATED");
    }
  });
});
