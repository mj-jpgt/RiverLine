import pg from "pg";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// T-A2 administrator dashboard — the acceptance scenario from this task's
// instructions: login as official -> dashboard shows real counts consistent
// with a direct db query made by the test -> filter to BORDERLINE -> table
// rows match db count -> CSV export downloads and parses with matching row
// count. Runs against a `next dev -p 3200` instance started by the operator
// (never the shared port 3000 webServer other agents/suites use), driven by
// test/unit/modules/a2/playwright.a2-dashboard.config.ts.
//
// Everything this spec asserts lives under ONE dedicated, randomly-suffixed
// jurisdiction created in beforeAll — so counts are exact regardless of
// whatever other data exists in the database from other concurrent agents'
// runs (RLS scopes every dashboard query to app.jurisdiction_id; a
// different jurisdiction's rows are structurally invisible here, not just
// filtered out by luck).

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const OFFICIAL_EMAIL = `a2-e2e-official-${RUN_ID}@example.gov`;

interface Seeded {
  jurisdictionId: string;
  userId: string;
}

async function seedDashboardData(admin: pg.Client): Promise<Seeded> {
  const j = await admin.query(
    `insert into jurisdictions (name, ordinance_citation, letterhead_config) values ($1, null, '{}'::jsonb) returning id`,
    [`A2 E2E Jurisdiction ${RUN_ID}`],
  );
  const jurisdictionId = j.rows[0].id as string;

  const u = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
    [OFFICIAL_EMAIL, jurisdictionId],
  );
  const userId = u.rows[0].id as string;

  async function seed(address: string, band: "SD" | "BORDERLINE" | "NOT_SD" | null, status: "draft" | "adopted" | null) {
    const parcelId = `A2E2E-${RUN_ID}-${address.replace(/\s+/g, "")}`;
    const s = await admin.query(
      `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft)
       values ($1, $2, $3, 180000, 'appraisal', 'residential', 1000) returning id`,
      [jurisdictionId, parcelId, address],
    );
    const structureId = s.rows[0].id as string;
    if (band === null) return;

    const clientId = `a2e2e-${RUN_ID}-${address.replace(/\s+/g, "")}`;
    const a = await admin.query(
      `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
       values ($1, $2, $3, $4, now()) returning id`,
      [structureId, jurisdictionId, userId, clientId],
    );
    const assessmentId = a.rows[0].id as string;

    const ratio = band === "SD" ? 0.85 : band === "BORDERLINE" ? 0.49 : 0.15;
    const c = await admin.query(
      `insert into calculations (assessment_id, jurisdiction_id, cost_table_version, total_repair_cost, market_value_used, value_source, ratio, threshold_result, engine_version)
       values ($1, $2, $3, $4, 180000, 'appraisal', $5, $6, 'test') returning id`,
      [assessmentId, jurisdictionId, `A2E2E-${RUN_ID}`, ratio * 180000, ratio, band],
    );

    if (status) {
      const calculationId = c.rows[0].id as string;
      if (status === "adopted") {
        await admin.query(
          `insert into determinations (structure_id, jurisdiction_id, calculation_id, status, adopted_by_user_id, adopted_at)
           values ($1, $2, $3, 'adopted', $4, now())`,
          [structureId, jurisdictionId, calculationId, userId],
        );
      } else {
        await admin.query(
          `insert into determinations (structure_id, jurisdiction_id, calculation_id, status) values ($1, $2, $3, $4)`,
          [structureId, jurisdictionId, calculationId, status],
        );
      }
    }
  }

  await seed("10 SD Adopted St", "SD", "adopted");
  await seed("11 Borderline One Ave", "BORDERLINE", "draft");
  await seed("12 Borderline Two Ave", "BORDERLINE", null);
  await seed("13 Not Sd Rd", "NOT_SD", null);
  await seed("14 Never Assessed Way", null, null);

  return { jurisdictionId, userId };
}

async function loginViaDevMagicLink(page: Page, request: APIRequestContext, baseURL: string | undefined, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").pressSequentially(email);
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(/sign-in link was sent/i);

  const linkResponse = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(email)}`);
  expect(linkResponse.ok()).toBe(true);
  const { url } = (await linkResponse.json()) as { url: string };
  await page.goto(new URL(url, baseURL).toString());
  await expect(page).toHaveURL(/\/home$/);
}

/** Minimal CSV parser sufficient for this suite's own hand-rolled export
 * (RFC 4180 quoting, CRLF lines) — deliberately independent of
 * src/modules/a2-dashboard/csv.ts so the test doesn't validate the export
 * against its own implementation. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // skip, \n handles the row break
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

test.describe("T-A2 administrator dashboard", () => {
  test.describe.configure({ mode: "serial" });

  let admin: pg.Client;
  let jurisdictionId: string;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — the a2-dashboard e2e suite needs riverline_test.");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    const seeded = await seedDashboardData(admin);
    jurisdictionId = seeded.jurisdictionId;
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("dashboard shows real counts consistent with a direct db query", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Jurisdiction caseload" })).toBeVisible();

    const dbTotal = await admin.query(`select count(*)::int as n from structures where jurisdiction_id = $1`, [jurisdictionId]);
    expect(dbTotal.rows[0].n).toBe(5);

    const dbBand = await admin.query(
      `select
         count(*) filter (where c.threshold_result = 'SD')::int as sd,
         count(*) filter (where c.threshold_result = 'BORDERLINE')::int as borderline,
         count(*) filter (where c.threshold_result = 'NOT_SD')::int as not_sd
       from calculations c where c.jurisdiction_id = $1`,
      [jurisdictionId],
    );
    expect(dbBand.rows[0].borderline).toBe(2);
    expect(dbBand.rows[0].sd).toBe(1);
    expect(dbBand.rows[0].not_sd).toBe(1);

    // "Total structures on record" stat matches the direct DB count.
    await expect(page.getByText("Structures on record").locator("..")).toContainText("5");

    // The by-band overview shows the same borderline count as the direct query.
    const borderlineRow = page.locator("dt", { hasText: "Borderline" }).first().locator("..");
    await expect(borderlineRow).toContainText("2");
  });

  test("filter to BORDERLINE: table rows match db count", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto("/dashboard");

    await page.getByRole("link", { name: "Borderline", exact: true }).click();
    await expect(page).toHaveURL(/band=BORDERLINE/);

    const dbCount = await admin.query(
      `select count(*)::int as n from calculations where jurisdiction_id = $1 and threshold_result = 'BORDERLINE'`,
      [jurisdictionId],
    );

    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(dbCount.rows[0].n);
    await expect(page.getByText("11 Borderline One Ave")).toBeVisible();
    await expect(page.getByText("12 Borderline Two Ave")).toBeVisible();
    await expect(page.getByText("10 SD Adopted St")).toHaveCount(0);
  });

  test("CSV export downloads and parses with a row count and content matching the db", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto("/dashboard");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream!.on("data", (c) => chunks.push(Buffer.from(c)));
      stream!.on("end", () => resolve());
      stream!.on("error", reject);
    });
    const csvText = Buffer.concat(chunks).toString("utf8");
    const table = parseCsv(csvText);

    const header = table[0]!;
    expect(header).toEqual([
      "address",
      "parcel_id",
      "ratio",
      "band",
      "determination_status",
      "adopted_date",
      "value_used",
      "value_source",
      "cost_table_version",
    ]);

    const dataRows = table.slice(1);
    const dbTotal = await admin.query(`select count(*)::int as n from structures where jurisdiction_id = $1`, [jurisdictionId]);
    expect(dataRows).toHaveLength(dbTotal.rows[0].n);

    // One real data row's header + values match the db content — the exact
    // proof point the task instructions require.
    const sdRow = dataRows.find((r) => r[0] === "10 SD Adopted St")!;
    expect(sdRow).toBeDefined();
    const dbRow = await admin.query(
      `select s.parcel_id, c.ratio, c.threshold_result, d.status, c.value_source, c.cost_table_version
       from structures s
       join assessments a on a.structure_id = s.id
       join calculations c on c.assessment_id = a.id
       left join determinations d on d.calculation_id = c.id
       where s.address = '10 SD Adopted St' and s.jurisdiction_id = $1`,
      [jurisdictionId],
    );
    expect(sdRow[1]).toBe(dbRow.rows[0].parcel_id);
    expect(Number(sdRow[2])).toBeCloseTo(Number(dbRow.rows[0].ratio), 3);
    expect(sdRow[3]).toBe(dbRow.rows[0].threshold_result);
    expect(sdRow[4]).toBe(dbRow.rows[0].status);
    expect(sdRow[7]).toBe(dbRow.rows[0].value_source);
    expect(sdRow[8]).toBe(dbRow.rows[0].cost_table_version);
  });

  test("full export (records request) downloads a real ZIP file", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto("/dashboard");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Full export (records request)" }).click();
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream!.on("data", (c) => chunks.push(Buffer.from(c)));
      stream!.on("end", () => resolve());
      stream!.on("error", reject);
    });
    const bytes = Buffer.concat(chunks);
    // ZIP local file header signature — proves a real archive, not a stub.
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from("MANIFEST.txt"))).toBe(true);
    expect(bytes.includes(Buffer.from("structures.csv"))).toBe(true);
  });

  test("role guard: an assessor cannot reach the dashboard or its export routes", async ({ browser, baseURL }) => {
    const assessorEmail = `a2-e2e-assessor-${RUN_ID}@example.gov`;
    await admin.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor')`, [
      assessorEmail,
      jurisdictionId,
    ]);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaDevMagicLink(page, context.request, baseURL, assessorEmail);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    const csvRes = await context.request.get("/dashboard/export/csv");
    expect(csvRes.status()).toBe(403);

    await context.close();
  });
});
