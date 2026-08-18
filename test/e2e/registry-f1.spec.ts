import pg from "pg";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// F1 registry coverage task: duplicate disambiguation, enrichment
// (suggest/accept), and the "Structure not found?" manual-creation path.
// Real data throughout — no mock/fixture structures (AGENTS.md rule 6);
// "0 Walnut St" (22 real, distinct parcels sharing that situs address) and
// "17200 River Rd" (a real, already-ingested parcel) were both verified
// present in riverline_dev via a direct DB query during this task's build,
// same as registry.spec.ts's own real-address convention.
//
// admin@example.gov (not official@example.gov, which registry.spec.ts
// already uses) — keeps this file's dev-magic-link requests from racing a
// same-email request in registry.spec.ts when both run in the same
// fullyParallel root suite.
const DEMO_EMAIL = "admin@example.gov";
const DUPLICATE_ADDRESS = "0 Walnut St";
const ENRICHMENT_ADDRESS = "17200 River Rd";
const ENRICHMENT_PARCEL_ID = "1010010102010001";

async function loginViaDevMagicLink(page: Page, request: APIRequestContext, baseURL: string | undefined) {
  await page.goto("/login");
  await page.getByLabel("Email address").pressSequentially(DEMO_EMAIL);
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(/sign-in link was sent/i);

  const linkResponse = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(DEMO_EMAIL)}`);
  expect(linkResponse.ok()).toBe(true);
  const { url } = (await linkResponse.json()) as { url: string };
  await page.goto(new URL(url, baseURL).toString());
  await expect(page).toHaveURL(/\/home$/);
}

test.describe("F1 registry: duplicate disambiguation", () => {
  test("structures sharing one situs address are shown as distinct, differentiated rows", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL);
    await page.goto("/registry");

    await page.getByLabel("Address").pressSequentially(DUPLICATE_ADDRESS);

    // Real coverage: "0 Walnut St" is 22 distinct real parcels (verified via
    // direct DB query during this task's build) — every result row is that
    // same address string, so the fix is each row showing a distinct parcel
    // number, not deduplication.
    const results = page.getByRole("listitem");
    await expect(results.first()).toBeVisible({ timeout: 10000 });
    const count = await results.count();
    expect(count).toBeGreaterThan(1);

    const rowTexts = await results.allTextContents();
    // Every row states its own parcel number ...
    for (const text of rowTexts) {
      expect(text).toMatch(/Parcel \d+/);
    }
    // ... and no two rows share the same parcel number, i.e. these are
    // genuinely distinct records, not the same row rendered twice.
    const parcelNumbers = rowTexts.map((t) => t.match(/Parcel (\d+)/)?.[1]);
    expect(new Set(parcelNumbers).size).toBe(parcelNumbers.length);
  });
});

test.describe("F1 registry: enrichment (autofill from the county record)", () => {
  test.describe.configure({ mode: "serial" });

  let pool: pg.Pool;
  let originalImprovementValue: string | null = null;
  let structureId: string;

  test.beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query(
      `select id, improvement_value from structures where parcel_id = $1`,
      [ENRICHMENT_PARCEL_ID],
    );
    if (rows.length === 0) {
      throw new Error(
        `Test setup: expected a real ingested structure for parcel ${ENRICHMENT_PARCEL_ID} (${ENRICHMENT_ADDRESS}). Run \`pnpm ingest:parcels\` against riverline_dev first.`,
      );
    }
    structureId = rows[0].id;
    originalImprovementValue = rows[0].improvement_value;
    // Blank the one field this test exercises, simulating "missing on file"
    // for a real, already-ingested parcel — restored in afterAll below
    // regardless of test outcome.
    await pool.query(`update structures set improvement_value = null where id = $1`, [structureId]);
  });

  test.afterAll(async () => {
    if (structureId) {
      await pool.query(`update structures set improvement_value = $1 where id = $2`, [
        originalImprovementValue,
        structureId,
      ]);
    }
    await pool.end();
  });

  test("suggests a missing field from the live county record, never auto-saves, and accept writes it", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL);
    await page.goto(`/registry/${structureId}`);

    await expect(page.getByRole("heading", { name: ENRICHMENT_ADDRESS })).toBeVisible();

    // Improvement value's own <dd> (not "Market value", which the ingest
    // never populates and always reads "Not on file" — see
    // scripts/preprocess/ingest-parcels.mjs's header comment on
    // assessor_market_value) renders honestly blank before enrichment runs.
    const improvementValueDd = page
      .locator("dt", { hasText: "Improvement value" })
      .locator("xpath=following-sibling::dd[1]");
    await expect(improvementValueDd).toHaveText("Not on file");

    // Automatic on-load check (task requirement: "automatic prefill at
    // assessment start when fields are missing") surfaces a suggestion
    // without any click.
    const suggestionHeading = page.getByText("Suggested from the county record");
    await expect(suggestionHeading).toBeVisible({ timeout: 15000 });

    const improvementRow = page.getByRole("listitem").filter({ hasText: "Improvement value" });
    await expect(improvementRow).toBeVisible();
    await expect(improvementRow.getByText(/County assessor record, fetched \d{4}-\d{2}-\d{2}/)).toBeVisible();

    // Nothing written yet — still blank in the real values card above until
    // the assessor explicitly accepts.
    await expect(improvementValueDd).toHaveText("Not on file");

    await improvementRow.getByRole("button", { name: "Accept" }).click();

    // Accepted value now renders in the real values card (page re-fetches
    // the structure server-side via router.refresh()), and the suggestion
    // for that field is gone.
    await expect(improvementValueDd).not.toHaveText("Not on file", { timeout: 10000 });
    await expect(page.getByRole("listitem").filter({ hasText: "Improvement value" })).toHaveCount(0);
  });
});

test.describe("F1 registry: 'Structure not found?' manual entry", () => {
  test("hand-creating a structure flags it as an unverified manual entry everywhere it renders", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL);
    await page.goto("/registry");

    const uniqueAddress = `${Date.now()} Manual Entry Test Ln`;
    await page.getByLabel("Address").pressSequentially(uniqueAddress);
    await expect(page.getByText(/no structures match that address/i)).toBeVisible({ timeout: 10000 });

    const notFoundLink = page.getByRole("link", { name: /structure not found/i });
    await expect(notFoundLink).toBeVisible();
    await notFoundLink.click();

    await expect(page).toHaveURL(/\/registry\/new/);
    await expect(page.getByRole("heading", { name: "Add a structure by hand" })).toBeVisible();

    const addressField = page.getByLabel("Address");
    await expect(addressField).toHaveValue(uniqueAddress);

    await page.getByRole("button", { name: "Save structure" }).click();

    await expect(page).toHaveURL(/\/registry\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: uniqueAddress })).toBeVisible();
    await expect(page.getByText(/unverified manual entry/i)).toBeVisible();

    // The same flag shows up back in search results, not only the detail
    // page — this is the disambiguation surface duplicates also use.
    await page.goto("/registry");
    await page.getByLabel("Address").pressSequentially(uniqueAddress);
    await expect(page.getByText(/unverified manual entry/i)).toBeVisible({ timeout: 10000 });
  });

  test("submitting an already-used real parcel number fails with a clear error, not a crash", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL);
    await page.goto("/registry/new");

    await page.getByLabel("Address").pressSequentially("Duplicate Parcel Test");
    await page.getByLabel(/Parcel number/i).pressSequentially(ENRICHMENT_PARCEL_ID);
    await page.getByRole("button", { name: "Save structure" }).click();

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/registry\/new/);
  });
});
