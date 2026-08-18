import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// T-W2 (A4 contractor-estimate intake, OCR-assisted, human-confirmed —
// docs/riverline-sdd-build-spec.md §8). Full browser + real tesseract.js
// OCR + real Postgres, no mocks. Every row this spec touches lives under
// its own randomly-suffixed jurisdiction (seeded directly via SQL in
// beforeAll, same pattern test/e2e/a2-dashboard.spec.ts already
// established) so it composes safely whether run via the dedicated
// test/unit/modules/a4/playwright.a4-estimates.config.ts (port 3600) or
// picked up by the shared `pnpm test:e2e` webServer (port 3000) — this
// module has no dependency on cost_tables/calculations at all, unlike
// T-C5/A1's own dedicated gates, so no data-precondition conflict exists
// and no testIgnore edit to the shared root playwright.config.ts is
// needed.
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ASSESSOR_EMAIL = `a4-e2e-assessor-${RUN_ID}@example.gov`;
const IMPROVEMENT_VALUE = 140000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLEAN_FIXTURE = path.resolve(__dirname, "../fixtures/estimates/clean-reconciling.png");
const MISMATCH_FIXTURE = path.resolve(__dirname, "../fixtures/estimates/mismatch.png");
const HIGH_VALUE_FIXTURE = path.resolve(__dirname, "../fixtures/estimates/high-value.png");

async function loginViaDevMagicLink(page: Page, request: APIRequestContext, baseURL: string | undefined) {
  await page.goto("/login");
  await page.getByLabel("Email address").pressSequentially(ASSESSOR_EMAIL);
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(/sign-in link was sent/i);

  const linkResponse = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(ASSESSOR_EMAIL)}`);
  expect(linkResponse.ok()).toBe(true);
  const { url } = (await linkResponse.json()) as { url: string };
  await page.goto(new URL(url, baseURL).toString());
  await expect(page).toHaveURL(/\/home$/);
}

let admin: pg.Client;
let jurisdictionId: string;
let userId: string;

async function seedAssessment(addressLabel: string): Promise<string> {
  const parcelId = `A4E2E-${RUN_ID}-${addressLabel}`;
  const s = await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, improvement_value, assessor_market_value, value_source)
     values ($1, $2, $3, $4, $5, 'appraisal') returning id`,
    [jurisdictionId, parcelId, addressLabel, IMPROVEMENT_VALUE, IMPROVEMENT_VALUE * 1.2],
  );
  const structureId = s.rows[0].id as string;
  const clientId = `a4e2e-${RUN_ID}-${addressLabel}`;
  await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
     values ($1, $2, $3, $4, now())`,
    [structureId, jurisdictionId, userId, clientId],
  );
  return clientId;
}

test.describe("T-W2 A4 contractor-estimate intake — OCR-assisted, human-confirmed", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — the A4 estimates e2e spec needs a real Postgres connection.");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();

    const j = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
      `A4 E2E Jurisdiction ${RUN_ID}`,
    ]);
    jurisdictionId = j.rows[0].id as string;
    const u = await admin.query(
      `insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor') returning id`,
      [ASSESSOR_EMAIL, jurisdictionId],
    );
    userId = u.rows[0].id as string;
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("upload -> OCR extracts a clean fixture -> confirm is gated until verified+total+scope -> confirmed row is asserted via DB", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120000);
    await loginViaDevMagicLink(page, request, baseURL);

    const clientId = await seedAssessment("clean-house");
    await page.goto(`/estimates/${encodeURIComponent(clientId)}/new`);
    await expect(page.getByRole("heading", { name: "Attach a document" })).toBeVisible();

    await page.getByLabel("Choose photo or file").setInputFiles(CLEAN_FIXTURE);
    await page.getByRole("button", { name: "Read text automatically and continue" }).click();

    // OCR runs client-side (real tesseract.js, real WASM) — generous
    // timeout for the worker/core/lang fetch + recognition.
    await expect(page).toHaveURL(/\/estimates\/[^/]+\/confirm\/[0-9a-f-]+$/, { timeout: 100000 });
    await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeVisible();

    // Every line item this fixture's OCR text should have produced.
    await expect(page.getByText("Roof covering replacement")).toBeVisible();
    await expect(page.getByText("Interior drywall and finish repair")).toBeVisible();
    await expect(page.getByText("Electrical system repair")).toBeVisible();
    await expect(page.getByText("Plumbing fixture replacement")).toBeVisible();
    await expect(page.getByText("Floor finish replacement")).toBeVisible();

    const confirmButton = page.getByRole("button", { name: "Confirm estimate" });
    await expect(confirmButton).toBeDisabled();

    // Scope checkbox alone is not enough.
    await page.getByLabel(/reviewed for disaster-related scope only/i).check();
    await expect(confirmButton).toBeDisabled();

    // Tapping the total is never automatic — the human must select it.
    // exact: true — this fixture also has a "Subtotal $12,500.00" row, and
    // Playwright's default accessible-name matching is substring-based, so
    // "Total $12,500.00" would otherwise also match "Subtotal $12,500.00".
    const totalRadio = page.getByRole("radio", { name: "Total $12,500.00", exact: true });
    await totalRadio.check();
    await expect(confirmButton).toBeDisabled(); // line items not yet verified

    const lineDescriptions = [
      "Roof covering replacement",
      "Interior drywall and finish repair",
      "Electrical system repair",
      "Plumbing fixture replacement",
      "Floor finish replacement",
    ];
    for (const description of lineDescriptions) {
      await page.getByLabel(`Include ${description}`).check();
      await expect(confirmButton).toBeDisabled(); // included but not yet verified
      await page.getByLabel(`Mark verified: ${description}`).check();
    }

    // All five included + verified, total tapped, scope reviewed, and the
    // sum reconciles exactly ($4,500 + $3,200 + $1,800 + $1,000 + $2,000 =
    // $12,500) — confirm is finally enabled.
    await expect(page.getByText(/Line items match the total/i)).toBeVisible();
    await expect(confirmButton).toBeEnabled();

    await confirmButton.click();
    await expect(page).toHaveURL(new RegExp(`/estimates/${clientId}$`));
    await expect(page.getByText("OCR-assisted, human-confirmed")).toBeVisible();
    await expect(page.getByText("$12,500.00")).toBeVisible();

    const row = await admin.query(
      `select confirmed_total, scope_reviewed, confirmed_by_user_id, extracted_json, ocr_engine
       from estimates where assessment_id = (select id from assessments where client_id = $1)`,
      [clientId],
    );
    expect(row.rows).toHaveLength(1);
    expect(Number(row.rows[0].confirmed_total)).toBe(12500);
    expect(row.rows[0].scope_reviewed).toBe(true);
    expect(row.rows[0].confirmed_by_user_id).toBe(userId);
    expect(row.rows[0].extracted_json).not.toBeNull();
    expect(row.rows[0].ocr_engine).toBe("tesseract.js");
  });

  test("manual-entry fallback: skipping OCR still attaches the document, and confirms as a new version with manual_entry provenance", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120000);
    await loginViaDevMagicLink(page, request, baseURL);

    const clientId = await seedAssessment("manual-house");
    await page.goto(`/estimates/${encodeURIComponent(clientId)}/new`);
    await page.getByLabel("Choose photo or file").setInputFiles(MISMATCH_FIXTURE);
    await page.getByRole("button", { name: "Skip automatic text reading — enter values by hand" }).click();

    await expect(page).toHaveURL(/\/estimates\/[^/]+\/confirm\/[0-9a-f-]+$/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Manual entry" })).toBeVisible();

    const confirmButton = page.getByRole("button", { name: "Confirm estimate" });
    await expect(confirmButton).toBeDisabled();

    await page.getByLabel("Confirmed total").fill("9500");
    await page.getByLabel("Line item 1 description").fill("Hand-entered repair total");
    await page.getByLabel("Line item 1 amount").fill("9500");
    await expect(confirmButton).toBeDisabled(); // scope not yet reviewed

    await page.getByLabel(/reviewed for disaster-related scope only/i).check();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page).toHaveURL(new RegExp(`/estimates/${clientId}$`));
    await expect(page.getByText("Manual entry")).toBeVisible();

    const row = await admin.query(
      `select version, confirmed_total, extracted_json from estimates
       where assessment_id = (select id from assessments where client_id = $1)`,
      [clientId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].version).toBe(1);
    expect(Number(row.rows[0].confirmed_total)).toBe(9500);
    expect(row.rows[0].extracted_json).toBeNull();
  });

  test("reconciliation mismatch requires an explicit acknowledgment before confirm is enabled (spec §8.1)", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120000);
    await loginViaDevMagicLink(page, request, baseURL);

    const clientId = await seedAssessment("mismatch-house");
    await page.goto(`/estimates/${encodeURIComponent(clientId)}/new`);
    await page.getByLabel("Choose photo or file").setInputFiles(MISMATCH_FIXTURE);
    await page.getByRole("button", { name: "Read text automatically and continue" }).click();
    await expect(page).toHaveURL(/\/estimates\/[^/]+\/confirm\/[0-9a-f-]+$/, { timeout: 100000 });

    await page.getByRole("radio", { name: "Total $9,000.00", exact: true }).check();
    for (const description of ["Foundation repair", "Superstructure framing repair"]) {
      await page.getByLabel(`Include ${description}`).check();
      await page.getByLabel(`Mark verified: ${description}`).check();
    }

    // $2,000 + $3,000 = $5,000, deliberately not $9,000 — a real, visible
    // mismatch, not a silently-accepted total.
    await expect(page.getByText(/does not match the selected total/i)).toBeVisible();

    const confirmButton = page.getByRole("button", { name: "Confirm estimate" });
    await page.getByLabel(/reviewed for disaster-related scope only/i).check();
    await expect(confirmButton).toBeDisabled(); // mismatch not yet acknowledged

    await page.getByLabel(/reviewed this mismatch/i).check();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page).toHaveURL(new RegExp(`/estimates/${clientId}$`));
    const row = await admin.query(
      `select confirmed_total from estimates where assessment_id = (select id from assessments where client_id = $1)`,
      [clientId],
    );
    expect(Number(row.rows[0].confirmed_total)).toBe(9000);
  });

  test("sanity bound (>3x improvement value) requires an explicit acknowledgment before confirm is enabled (spec §8.6)", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120000);
    await loginViaDevMagicLink(page, request, baseURL);

    const clientId = await seedAssessment("highvalue-house");
    await page.goto(`/estimates/${encodeURIComponent(clientId)}/new`);
    await page.getByLabel("Choose photo or file").setInputFiles(HIGH_VALUE_FIXTURE);
    await page.getByRole("button", { name: "Read text automatically and continue" }).click();
    await expect(page).toHaveURL(/\/estimates\/[^/]+\/confirm\/[0-9a-f-]+$/, { timeout: 100000 });

    await page.getByRole("radio", { name: "Total $500,000.00", exact: true }).check();
    await page.getByLabel("Include Full structure rebuild").check();
    await page.getByLabel("Mark verified: Full structure rebuild").check();

    // 500,000 > 3 x 140,000 (420,000) — the hard-flag warning must appear.
    await expect(page.getByText(/exceeds 3× the structure's assessed improvement value/i)).toBeVisible();

    const confirmButton = page.getByRole("button", { name: "Confirm estimate" });
    await page.getByLabel(/reviewed for disaster-related scope only/i).check();
    await expect(confirmButton).toBeDisabled(); // sanity bound not yet acknowledged

    await page.getByLabel(/verified this figure is correct despite the bound/i).check();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page).toHaveURL(new RegExp(`/estimates/${clientId}$`));
    await expect(page.getByText(/exceeds 3× the structure's assessed improvement value/i)).toBeVisible();
  });
});
