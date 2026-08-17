import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../../scripts/db/migrate.mjs";
import { getCaseload, getCaseloadForExport, getDashboardCounts, getFullExportTables } from "../../../../src/modules/a2-dashboard/queries";

// T-A2: real Postgres, real writes, no mocks — proves the dashboard's
// tenant scoping (RLS via withTenant, not app-level filtering), the status
// overview counts, and the caseload query's filter/sort/pagination
// composition against a real database. AGENTS.md rule 6: only ever seeds
// riverline_test. Everything this suite creates lives under ONE randomly
// suffixed jurisdiction, so it never collides with data other concurrent
// agents/suites create in riverline_test, and its own count assertions are
// exact regardless of what else exists in the database (RLS scopes every
// query to app.jurisdiction_id).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The dashboard suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionId: string;
let userId: string;
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface Seeded {
  structureId: string;
  address: string;
  band: "SD" | "BORDERLINE" | "NOT_SD" | null;
  status: "draft" | "adopted" | "contested" | "superseded" | null;
  completedAt: string | null;
}
const seeded: Seeded[] = [];

async function seedStructure(opts: {
  address: string;
  ratio?: number;
  band?: "SD" | "BORDERLINE" | "NOT_SD";
  status?: "draft" | "adopted" | "contested" | "superseded";
  completedAt?: string;
}): Promise<Seeded> {
  const parcelId = `A2-${RUN_ID}-${opts.address.replace(/\s+/g, "")}`;
  const s = await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft)
     values ($1, $2, $3, 180000, 'appraisal', 'residential', 1000) returning id`,
    [jurisdictionId, parcelId, opts.address],
  );
  const structureId = s.rows[0].id as string;

  if (opts.band === undefined) {
    seeded.push({ structureId, address: opts.address, band: null, status: null, completedAt: null });
    return seeded[seeded.length - 1]!;
  }

  const completedAt = opts.completedAt ?? "2026-08-01T12:00:00Z";
  const clientId = `a2-client-${RUN_ID}-${opts.address.replace(/\s+/g, "")}`;
  const a = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [structureId, jurisdictionId, userId, clientId, completedAt],
  );
  const assessmentId = a.rows[0].id as string;

  const ratio = opts.ratio ?? (opts.band === "SD" ? 0.9 : opts.band === "BORDERLINE" ? 0.48 : 0.1);
  const versionTag = `A2-TEST-${RUN_ID}`;
  const c = await admin.query(
    `insert into calculations (assessment_id, jurisdiction_id, cost_table_version, total_repair_cost, market_value_used, value_source, ratio, threshold_result, engine_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'test') returning id`,
    [assessmentId, jurisdictionId, versionTag, ratio * 180000, 180000, "appraisal", ratio, opts.band],
  );
  const calculationId = c.rows[0].id as string;

  let status: Seeded["status"] = null;
  if (opts.status) {
    if (opts.status === "adopted") {
      await admin.query(
        `insert into determinations (structure_id, jurisdiction_id, calculation_id, status, adopted_by_user_id, adopted_at)
         values ($1, $2, $3, 'adopted', $4, now())`,
        [structureId, jurisdictionId, calculationId, userId],
      );
    } else {
      await admin.query(
        `insert into determinations (structure_id, jurisdiction_id, calculation_id, status)
         values ($1, $2, $3, $4)`,
        [structureId, jurisdictionId, calculationId, opts.status],
      );
    }
    status = opts.status;
  }

  seeded.push({ structureId, address: opts.address, band: opts.band, status, completedAt });
  return seeded[seeded.length - 1]!;
}

describe("T-A2 dashboard queries — real Postgres, tenant-scoped", () => {
  beforeAll(async () => {
    await ensureDatabaseExists(testUrl);
    await applyMigrations(testUrl);
    admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();

    const j = await admin.query(
      `insert into jurisdictions (name, ordinance_citation, letterhead_config) values ($1, null, '{}'::jsonb) returning id`,
      [`A2 Test Jurisdiction ${RUN_ID}`],
    );
    jurisdictionId = j.rows[0].id as string;

    const u = await admin.query(
      `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
      [`a2-official-${RUN_ID}@example.gov`, jurisdictionId],
    );
    userId = u.rows[0].id as string;

    // Population: one of each band/status combination the counts must
    // distinguish, plus a never-assessed structure and an assessed-but-no-
    // calculation-yet structure (both fold into "no calculation").
    await seedStructure({ address: "1 Sd Adopted St", band: "SD", status: "adopted", completedAt: "2026-08-01T00:00:00Z" });
    await seedStructure({ address: "2 Borderline Draft Ave", band: "BORDERLINE", status: "draft", completedAt: "2026-08-05T00:00:00Z" });
    await seedStructure({ address: "3 Not Sd Contested Rd", band: "NOT_SD", status: "contested", completedAt: "2026-08-10T00:00:00Z" });
    await seedStructure({ address: "4 Superseded Ln", band: "SD", status: "superseded", completedAt: "2026-08-12T00:00:00Z" });
    await seedStructure({ address: "5 No Determination Ct", band: "NOT_SD", completedAt: "2026-08-15T00:00:00Z" });
    await seedStructure({ address: "6 Never Assessed Way" }); // no assessment at all
  });

  afterAll(async () => {
    await admin.end();
  });

  it("getDashboardCounts: exact counts scoped to this jurisdiction only", async () => {
    const counts = await getDashboardCounts(jurisdictionId, userId);
    expect(counts.totalStructures).toBe(6);

    expect(counts.byDeterminationStatus).toEqual({
      draft: 1,
      adopted: 1,
      contested: 1,
      superseded: 1,
      none: 2, // "5 No Determination Ct" (has calc, no determination) + "6 Never Assessed Way"
    });

    expect(counts.byCalculationBand).toEqual({
      SD: 2, // adopted + superseded
      BORDERLINE: 1,
      NOT_SD: 2,
      noCalculation: 1, // "6 Never Assessed Way"
    });
  });

  it("getCaseload: one row per structure, correct band/status per row", async () => {
    const page = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "ALL", dateFrom: null, dateTo: null },
      "address",
      "asc",
      1,
      50,
    );
    expect(page.totalCount).toBe(6);
    expect(page.rows).toHaveLength(6);

    const bySd = page.rows.find((r) => r.address === "1 Sd Adopted St")!;
    expect(bySd.band).toBe("SD");
    expect(bySd.determinationStatus).toBe("adopted");

    const neverAssessed = page.rows.find((r) => r.address === "6 Never Assessed Way")!;
    expect(neverAssessed.band).toBeNull();
    expect(neverAssessed.determinationStatus).toBeNull();
    expect(neverAssessed.assessmentId).toBeNull();
  });

  it("filters compose: band=SD AND status filter narrows correctly", async () => {
    const sdOnly = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "SD", dateFrom: null, dateTo: null },
      "address",
      "asc",
      1,
      50,
    );
    expect(sdOnly.totalCount).toBe(2);
    expect(sdOnly.rows.every((r) => r.band === "SD")).toBe(true);

    const sdAdoptedOnly = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "adopted", band: "SD", dateFrom: null, dateTo: null },
      "address",
      "asc",
      1,
      50,
    );
    expect(sdAdoptedOnly.totalCount).toBe(1);
    expect(sdAdoptedOnly.rows[0]!.address).toBe("1 Sd Adopted St");
  });

  it("band=NONE and status=NONE isolate the no-calculation / no-determination rows", async () => {
    const noBand = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "NONE", dateFrom: null, dateTo: null },
      "address",
      "asc",
      1,
      50,
    );
    expect(noBand.totalCount).toBe(1);
    expect(noBand.rows[0]!.address).toBe("6 Never Assessed Way");

    const noDet = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "NONE", band: "ALL", dateFrom: null, dateTo: null },
      "address",
      "asc",
      1,
      50,
    );
    expect(noDet.totalCount).toBe(2);
  });

  it("search filters by address substring, case-insensitive", async () => {
    const result = await getCaseload(
      jurisdictionId,
      userId,
      { search: "borderline", status: "ALL", band: "ALL", dateFrom: null, dateTo: null },
      "address",
      "asc",
      1,
      50,
    );
    expect(result.totalCount).toBe(1);
    expect(result.rows[0]!.address).toBe("2 Borderline Draft Ave");
  });

  it("date range filters by completed_at", async () => {
    const result = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "ALL", dateFrom: "2026-08-10", dateTo: "2026-08-12" },
      "address",
      "asc",
      1,
      50,
    );
    const addresses = result.rows.map((r) => r.address).sort();
    expect(addresses).toEqual(["3 Not Sd Contested Rd", "4 Superseded Ln"]);
  });

  it("sort by ratio descending puts the highest ratio first", async () => {
    const result = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "ALL", dateFrom: null, dateTo: null },
      "ratio",
      "desc",
      1,
      50,
    );
    const firstWithRatio = result.rows.find((r) => r.ratio !== null);
    expect(firstWithRatio?.ratio).toBeCloseTo(0.9);
  });

  it("pagination: pageSize=2 returns 2 rows per page and the right totalCount", async () => {
    const p1 = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "ALL", dateFrom: null, dateTo: null },
      "address",
      "asc",
      1,
      2,
    );
    expect(p1.rows).toHaveLength(2);
    expect(p1.totalCount).toBe(6);

    const p3 = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "ALL", dateFrom: null, dateTo: null },
      "address",
      "asc",
      3,
      2,
    );
    expect(p3.rows).toHaveLength(2);
    // No overlap between page 1 and page 3.
    const p1Ids = new Set(p1.rows.map((r) => r.structureId));
    expect(p3.rows.every((r) => !p1Ids.has(r.structureId))).toBe(true);
  });

  it("a malicious sortColumn value that bypasses the TypeScript type still can't reach SQL (defense in depth)", async () => {
    const malicious = "id; DROP TABLE structures; --" as unknown as Parameters<typeof getCaseload>[3];
    const result = await getCaseload(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "ALL", dateFrom: null, dateTo: null },
      malicious,
      "asc",
      1,
      50,
    );
    // Falls back to the default sort; does not throw, does not corrupt data.
    expect(result.totalCount).toBe(6);

    const stillThere = await admin.query(`select count(*)::int as n from structures where jurisdiction_id = $1`, [jurisdictionId]);
    expect(stillThere.rows[0].n).toBe(6);
  });

  it("getCaseloadForExport returns the full filtered set, unpaginated", async () => {
    const all = await getCaseloadForExport(
      jurisdictionId,
      userId,
      { search: null, status: "ALL", band: "ALL", dateFrom: null, dateTo: null },
      "address",
      "asc",
    );
    expect(all).toHaveLength(6);
  });

  it("a different jurisdiction sees none of this data (RLS tenant isolation)", async () => {
    const other = await admin.query(
      `insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`,
      [`A2 Other Jurisdiction ${RUN_ID}`],
    );
    const otherJurisdictionId = other.rows[0].id as string;
    const otherUser = await admin.query(
      `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
      [`a2-other-${RUN_ID}@example.gov`, otherJurisdictionId],
    );
    const counts = await getDashboardCounts(otherJurisdictionId, otherUser.rows[0].id as string);
    expect(counts.totalStructures).toBe(0);
  });

  it("getFullExportTables returns every tenant-scoped table, jurisdiction-scoped, with the seeded rows present", async () => {
    const tables = await getFullExportTables(jurisdictionId, userId);
    const names = tables.map((t) => t.tableName);
    expect(names).toEqual([
      "jurisdictions",
      "users",
      "structures",
      "assessments",
      "assessment_elements",
      "photos",
      "calculations",
      "determinations",
      "letters",
      "audit_log",
    ]);
    const structuresTable = tables.find((t) => t.tableName === "structures")!;
    expect(structuresTable.rows).toHaveLength(6);
    expect(structuresTable.columns).toContain("address");

    const jurisdictionsTable = tables.find((t) => t.tableName === "jurisdictions")!;
    expect(jurisdictionsTable.rows).toHaveLength(1);
    expect(jurisdictionsTable.rows[0]!.id).toBe(jurisdictionId);
  });
});
