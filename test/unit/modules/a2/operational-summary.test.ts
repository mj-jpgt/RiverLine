import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../../scripts/db/migrate.mjs";
import { getOperationalSummary } from "../../../../src/modules/a2-dashboard/queries";

// V5 task 3: "jurisdiction operational picture" — the numbers an EMA/county
// would ask for during an event. Real Postgres, real writes, no mocks, same
// discipline as test/unit/modules/a2/queries.test.ts (RLS tenant scoping via
// withTenant, one randomly-suffixed jurisdiction so this suite's exact
// counts are unaffected by whatever else concurrent agents seed into
// riverline_test).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. This suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
// getOperationalSummary goes through withTenant() -> getPool(), which reads
// process.env.DATABASE_URL lazily on first use and caches the pool — must be
// pointed at riverline_test BEFORE that first call, same as
// test/unit/modules/a2/queries.test.ts does for the sibling queries.
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionId: string;
let userId: string;
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedStructure(opts: {
  address: string;
  occupancy?: "residential" | "non_residential" | null;
  band?: "SD" | "BORDERLINE" | "NOT_SD";
  totalRepairCost?: number;
  status?: "draft" | "adopted";
}) {
  const parcelId = `OPS-${RUN_ID}-${opts.address.replace(/\s+/g, "")}`;
  const s = await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft)
     values ($1, $2, $3, 200000, 'appraisal', $4, 1200) returning id`,
    [jurisdictionId, parcelId, opts.address, opts.occupancy ?? null],
  );
  const structureId = s.rows[0].id as string;
  if (!opts.band) return structureId;

  const clientId = `ops-client-${RUN_ID}-${opts.address.replace(/\s+/g, "")}`;
  const a = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
     values ($1, $2, $3, $4, now()) returning id`,
    [structureId, jurisdictionId, userId, clientId],
  );
  const assessmentId = a.rows[0].id as string;

  const ratio = opts.band === "SD" ? 0.9 : opts.band === "BORDERLINE" ? 0.48 : 0.1;
  const totalRepairCost = opts.totalRepairCost ?? ratio * 200000;
  const c = await admin.query(
    `insert into calculations (assessment_id, jurisdiction_id, cost_table_version, total_repair_cost, market_value_used, value_source, ratio, threshold_result, engine_version)
     values ($1, $2, $3, $4, 200000, 'appraisal', $5, $6, 'test') returning id`,
    [assessmentId, jurisdictionId, `OPS-TEST-${RUN_ID}`, totalRepairCost, ratio, opts.band],
  );
  const calculationId = c.rows[0].id as string;

  if (opts.status === "adopted") {
    await admin.query(
      `insert into determinations (structure_id, jurisdiction_id, calculation_id, status, adopted_by_user_id, adopted_at)
       values ($1, $2, $3, 'adopted', $4, now())`,
      [structureId, jurisdictionId, calculationId, userId],
    );
  } else if (opts.status === "draft") {
    await admin.query(`insert into determinations (structure_id, jurisdiction_id, calculation_id, status) values ($1, $2, $3, 'draft')`, [
      structureId,
      jurisdictionId,
      calculationId,
    ]);
  }

  return structureId;
}

describe("getOperationalSummary — real Postgres, tenant-scoped", () => {
  beforeAll(async () => {
    await ensureDatabaseExists(testUrl);
    await applyMigrations(testUrl);
    admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();

    const j = await admin.query(
      `insert into jurisdictions (name, ordinance_citation, letterhead_config) values ($1, null, '{}'::jsonb) returning id`,
      [`Ops Summary Test Jurisdiction ${RUN_ID}`],
    );
    jurisdictionId = j.rows[0].id as string;

    const u = await admin.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`, [
      `ops-official-${RUN_ID}@example.gov`,
      jurisdictionId,
    ]);
    userId = u.rows[0].id as string;

    // Two adopted residential SD, one draft residential SD (not adopted —
    // must NOT count toward adoptedSdCount), one residential borderline,
    // one residential not-SD, one non-residential SD, one unknown-occupancy
    // SD, one never-assessed structure of unspecified occupancy.
    await seedStructure({ address: "1 Res Sd Adopted", occupancy: "residential", band: "SD", totalRepairCost: 150000, status: "adopted" });
    await seedStructure({ address: "2 Res Sd Adopted Two", occupancy: "residential", band: "SD", totalRepairCost: 160000, status: "adopted" });
    await seedStructure({ address: "3 Res Sd Draft", occupancy: "residential", band: "SD", totalRepairCost: 170000, status: "draft" });
    await seedStructure({ address: "4 Res Borderline", occupancy: "residential", band: "BORDERLINE", totalRepairCost: 90000 });
    await seedStructure({ address: "5 Res Not Sd", occupancy: "residential", band: "NOT_SD", totalRepairCost: 20000 });
    await seedStructure({ address: "6 Nonres Sd", occupancy: "non_residential", band: "SD", totalRepairCost: 500000, status: "adopted" });
    await seedStructure({ address: "7 Unknown Occupancy Sd", occupancy: null, band: "SD", totalRepairCost: 80000 });
    await seedStructure({ address: "8 Never Assessed", occupancy: "residential" });
  });

  afterAll(async () => {
    await admin.end();
  });

  it("totals and status/band counts match the existing dashboard counts shape", async () => {
    const summary = await getOperationalSummary(jurisdictionId, userId);
    expect(summary.totalStructures).toBe(8);
    expect(summary.byDeterminationStatus.adopted).toBe(3); // 2 residential SD + 1 non-residential SD
    expect(summary.byDeterminationStatus.draft).toBe(1);
    expect(summary.byCalculationBand.SD).toBe(5); // 3 residential + 1 non-res + 1 unknown-occupancy
    expect(summary.byCalculationBand.BORDERLINE).toBe(1);
    expect(summary.byCalculationBand.NOT_SD).toBe(1);
    expect(summary.byCalculationBand.noCalculation).toBe(1); // "8 Never Assessed"
  });

  it("adoptedSdCount counts only ADOPTED determinations whose band is SD — a draft SD does not count", async () => {
    const summary = await getOperationalSummary(jurisdictionId, userId);
    // 2 residential adopted-SD + 1 non-residential adopted-SD = 3.
    // The draft residential SD ("3 Res Sd Draft") must NOT be included.
    expect(summary.adoptedSdCount).toBe(3);
  });

  it("byOccupancyAndBand cross-breaks damage category by occupancy, including an 'unknown' bucket for null occupancy_type", async () => {
    const summary = await getOperationalSummary(jurisdictionId, userId);
    expect(summary.byOccupancyAndBand.residential).toEqual({ SD: 3, BORDERLINE: 1, NOT_SD: 1, noCalculation: 1 });
    expect(summary.byOccupancyAndBand.nonResidential).toEqual({ SD: 1, BORDERLINE: 0, NOT_SD: 0, noCalculation: 0 });
    expect(summary.byOccupancyAndBand.unknownOccupancy).toEqual({ SD: 1, BORDERLINE: 0, NOT_SD: 0, noCalculation: 0 });
  });

  it("totalComputedRepairCost sums the latest calculation's total_repair_cost, overall and per band", async () => {
    const summary = await getOperationalSummary(jurisdictionId, userId);
    // SD: 150000 + 160000 + 170000 + 500000 + 80000 = 1,060,000
    expect(summary.totalComputedRepairCost.SD).toBeCloseTo(1_060_000, 0);
    expect(summary.totalComputedRepairCost.BORDERLINE).toBeCloseTo(90_000, 0);
    expect(summary.totalComputedRepairCost.NOT_SD).toBeCloseTo(20_000, 0);
    expect(summary.totalComputedRepairCost.total).toBeCloseTo(1_060_000 + 90_000 + 20_000, 0);
  });

  it("a different jurisdiction sees none of this data (RLS tenant isolation)", async () => {
    const other = await admin.query(`insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`, [
      `Ops Summary Other Jurisdiction ${RUN_ID}`,
    ]);
    const otherJurisdictionId = other.rows[0].id as string;
    const otherUser = await admin.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`, [
      `ops-other-${RUN_ID}@example.gov`,
      otherJurisdictionId,
    ]);
    const summary = await getOperationalSummary(otherJurisdictionId, otherUser.rows[0].id as string);
    expect(summary.totalStructures).toBe(0);
    expect(summary.adoptedSdCount).toBe(0);
    expect(summary.totalComputedRepairCost.total).toBeNull();
  });
});
