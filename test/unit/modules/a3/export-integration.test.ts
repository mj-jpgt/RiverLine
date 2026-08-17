import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../../scripts/db/migrate.mjs";
import { computeAndPersistCalculation } from "../../../../app/calculation/_lib/compute";
import { getExportAssessmentData, getBatchExportData } from "../../../../src/modules/a3-sde-export/queries";
import { buildAssessmentExportJson } from "../../../../src/modules/a3-sde-export/build-export";
import { requireRole, AuthError } from "../../../../src/core/auth/role-guard";
import type { SessionPayload } from "../../../../src/core/auth/session";
import costTableFixture from "../../../fixtures/engine/cost-table.test-fixture-v0.json";

// Real Postgres, real writes, no mocks — proves T-A3's export queries end to
// end: tenant scoping via withTenant()/RLS (not app-level filtering,
// AGENTS.md "data / backend agents" rule 1), and honest "no_calculation"
// reporting. Same recipe as test/unit/determination/persist.test.ts and
// test/unit/engine/persist.test.ts. AGENTS.md rule 6: only ever seeds
// riverline_test.
//
// This module has no route-level HTTP test: cookies()/next/headers require
// a real request context that nothing else in this codebase unit-tests
// directly (no existing precedent for importing a route.ts handler in
// test/unit — grep confirms it), and the 10-minute foreground cap makes a
// reliable Playwright round trip risky to fit in one gate. Instead, the
// role gate itself (requireRole, the exact function
// app/api/sde-export/[clientId]/route.ts and app/api/sde-export/batch/route.ts
// both call) is exercised directly below with an "assessor" session,
// proving the 403 path the route delegates to. See journal for the full
// justification.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The export integration suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionAId: string;
let jurisdictionBId: string;
let userAId: string;
let userBId: string;

const DAMAGE: Record<string, number> = {
  foundations: 25,
  superstructure: 50,
  roof_covering: 100,
  interior_finish: 75,
  floor_finish: 50,
  plumbing: 25,
  electrical: 25,
};

async function seedCostTable(jurisdictionId: string): Promise<string> {
  const version = `${costTableFixture.version}-${jurisdictionId}`;
  await admin.query(
    `insert into cost_tables (version, jurisdiction_id, source_citation, effective_date, json_payload)
     values ($1, $2, $3, $4, $5)
     on conflict (version) do nothing`,
    [
      version,
      jurisdictionId,
      costTableFixture.source_citation,
      costTableFixture.effective_date,
      JSON.stringify({ base_cost_per_sqft: costTableFixture.base_cost_per_sqft }),
    ],
  );
  return version;
}

async function seedAssessment(
  jurisdictionId: string,
  userId: string,
  addressLabel: string,
  marketValue: number,
  damage: Record<string, number> | null,
): Promise<{ clientId: string; structureId: string; assessmentId: string }> {
  const parcelId = `A3-TEST-${addressLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const s = await admin.query(
    `insert into structures (
       jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft, year_built, stories, foundation_type
     ) values ($1, $2, $3, $4, 'appraisal', 'residential', 1000, 1990, 1, 'slab') returning id`,
    [jurisdictionId, parcelId, addressLabel, marketValue],
  );
  const structureId = s.rows[0].id as string;

  const clientId = `a3-test-${addressLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const a = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at, water_depth_interior_in, water_depth_source)
     values ($1, $2, $3, $4, now(), 12, 'measured') returning id`,
    [structureId, jurisdictionId, userId, clientId],
  );
  const assessmentId = a.rows[0].id as string;

  if (damage) {
    for (const [code, pct] of Object.entries(damage)) {
      await admin.query(
        `insert into assessment_elements (assessment_id, jurisdiction_id, element_code, damage_pct, cost_table_version)
         values ($1, $2, $3, $4, 'NONE')`,
        [assessmentId, jurisdictionId, code, pct],
      );
    }
  }

  return { clientId, structureId, assessmentId };
}

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const ja = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    "A3 Export Test Jurisdiction A",
  ]);
  jurisdictionAId = ja.rows[0].id;
  await seedCostTable(jurisdictionAId);
  const ua = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
    [`a3-test-a-${Date.now()}@example.gov`, jurisdictionAId],
  );
  userAId = ua.rows[0].id;

  const jb = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    "A3 Export Test Jurisdiction B",
  ]);
  jurisdictionBId = jb.rows[0].id;
  await seedCostTable(jurisdictionBId);
  const ub = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
    [`a3-test-b-${Date.now()}@example.gov`, jurisdictionBId],
  );
  userBId = ub.rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

describe("getExportAssessmentData", () => {
  it("returns the full export shape for a real assessment-with-calculation, 12 residential elements", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "export-house", 100000, DAMAGE);
    const computed = await computeAndPersistCalculation(jurisdictionAId, userAId, target.clientId);
    expect(computed.status).toBe("ok");

    const result = await getExportAssessmentData(jurisdictionAId, userAId, target.clientId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");

    expect(result.data.elements).toHaveLength(12);
    expect(result.data.address).toBe("export-house");
    expect(result.data.occupancyType).toBe("residential");
    expect(result.data.totalRepairCost).toBe(39250);
    expect(result.data.marketValueUsed).toBe(100000);
    expect(result.data.thresholdResult).toBe("NOT_SD");
    expect(result.data.waterDepthInteriorIn).toBe(12);
    expect(result.data.waterDepthSource).toBe("measured");
    expect(result.data.determination).toBeNull();

    const json = buildAssessmentExportJson(result.data, "2026-08-17T00:00:00.000Z");
    expect(json.export_schema_version).toBe("1.0");
    expect(json.elements).toHaveLength(12);
  });

  it("reports no_calculation honestly instead of a partial/fabricated export", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "no-calc-house", 100000, null);
    const result = await getExportAssessmentData(jurisdictionAId, userAId, target.clientId);
    expect(result).toEqual({ status: "no_calculation" });
  });

  it("reports not_found for an unknown client_id", async () => {
    const result = await getExportAssessmentData(jurisdictionAId, userAId, "no-such-client-id");
    expect(result).toEqual({ status: "not_found" });
  });

  it("is tenant-scoped: jurisdiction B cannot read jurisdiction A's assessment via RLS", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "cross-tenant-house", 100000, DAMAGE);
    const computed = await computeAndPersistCalculation(jurisdictionAId, userAId, target.clientId);
    expect(computed.status).toBe("ok");

    // Same client_id looked up as jurisdiction B: RLS (app.jurisdiction_id)
    // hides the row entirely — not a 403, a real "not found", because the
    // row is genuinely invisible under B's session, same as every other
    // tenant-scoped query in this codebase (src/core/determination/queries.ts).
    const crossTenantResult = await getExportAssessmentData(jurisdictionBId, userBId, target.clientId);
    expect(crossTenantResult).toEqual({ status: "not_found" });

    // Confirms it over-restricts, not under: same jurisdiction still finds it.
    const sameTenantResult = await getExportAssessmentData(jurisdictionAId, userAId, target.clientId);
    expect(sameTenantResult.status).toBe("ok");
  });
});

describe("getBatchExportData", () => {
  it("only returns the calling jurisdiction's completed, calculated assessments", async () => {
    const a1 = await seedAssessment(jurisdictionAId, userAId, "batch-a1", 100000, DAMAGE);
    await computeAndPersistCalculation(jurisdictionAId, userAId, a1.clientId);
    const b1 = await seedAssessment(jurisdictionBId, userBId, "batch-b1", 100000, DAMAGE);
    await computeAndPersistCalculation(jurisdictionBId, userBId, b1.clientId);

    const batchA = await getBatchExportData(jurisdictionAId, userAId);
    const addressesA = batchA.map((d) => d.address);
    expect(addressesA).toContain("batch-a1");
    expect(addressesA).not.toContain("batch-b1");

    const batchB = await getBatchExportData(jurisdictionBId, userBId);
    const addressesB = batchB.map((d) => d.address);
    expect(addressesB).toContain("batch-b1");
    expect(addressesB).not.toContain("batch-a1");
  });
});

describe("role gate — the exact mechanism app/api/sde-export/**/route.ts calls", () => {
  const assessorSession: SessionPayload = {
    userId: "u1",
    jurisdictionId: "j1",
    role: "assessor",
    email: "assessor@example.gov",
    iat: 0,
    exp: 0,
  };
  const officialSession: SessionPayload = {
    userId: "u2",
    jurisdictionId: "j1",
    role: "official",
    email: "official@example.gov",
    iat: 0,
    exp: 0,
  };
  const adminSession: SessionPayload = {
    userId: "u3",
    jurisdictionId: "j1",
    role: "admin",
    email: "admin@example.gov",
    iat: 0,
    exp: 0,
  };

  it("rejects assessor with AuthError FORBIDDEN (route maps this to HTTP 403)", () => {
    expect(() => requireRole(assessorSession, ["admin", "official"])).toThrow(AuthError);
    try {
      requireRole(assessorSession, ["admin", "official"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("FORBIDDEN");
    }
  });

  it("rejects no session with AuthError UNAUTHENTICATED (route maps this to HTTP 401)", () => {
    try {
      requireRole(null, ["admin", "official"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("UNAUTHENTICATED");
    }
  });

  it("allows official", () => {
    expect(requireRole(officialSession, ["admin", "official"])).toBe(officialSession);
  });

  it("allows admin", () => {
    expect(requireRole(adminSession, ["admin", "official"])).toBe(adminSession);
  });
});
