import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test, type Page, type APIRequestContext, type Browser } from "@playwright/test";

// T-C5 M4 determination + adoption workflow — the full LT-3 chain
// (docs/testing/live-test-plan.md): assessor captures -> syncs -> official
// reviews the queue (borderline-first) -> overrides one element with a
// mandatory reason -> a NEW calculations row is asserted via direct DB
// query -> adopts with explicit confirmation -> the determinations row and
// the full audit chain (override + adoption) are asserted via DB -> the
// supersede flow is exercised and asserted. Also proves the role guard:
// an assessor attempting to adopt gets 403, not a silently-hidden button.
//
// Runs under scripts/test-determination.mjs against riverline_test (see
// playwright.determination.config.ts's file header for why this needs its
// own harness rather than the normal `pnpm test:e2e` webServer).
const ASSESSOR_EMAIL = "assessor@example.gov";
const OFFICIAL_EMAIL = "official@example.gov";
const PRACTICE_ADDRESS = "123 Practice Ln";
const RESIDENTIAL_ELEMENT_COUNT = 12;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTERIOR_FIXTURE = path.resolve(__dirname, "../fixtures/photos/sample-exterior.jpg");

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

/** Drives a full 12-element residential capture on the seeded practice
 * structure with a uniform damage % on every element, syncs, and returns
 * the resulting clientId (read off the /calculation/[clientId] URL the
 * post-sync "View calculation" button navigates to). */
async function captureFullAssessment(page: Page, uniformDamagePct: number): Promise<string> {
  await page.goto("/registry");
  const searchInput = page.getByLabel("Address");
  await searchInput.pressSequentially(PRACTICE_ADDRESS);
  const resultLink = page.getByRole("link", { name: new RegExp(PRACTICE_ADDRESS) });
  await expect(resultLink).toBeVisible({ timeout: 10000 });
  await resultLink.click();
  await expect(page).toHaveURL(/\/registry\/[0-9a-f-]+$/);

  const startAssessment = page.getByRole("link", { name: "Start assessment" });
  await expect(startAssessment).toBeVisible();
  await startAssessment.click();
  await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/);

  await expect(page.getByRole("button", { name: "Residential", exact: true })).toHaveAttribute(
    "class",
    /optionButtonSelected/,
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();

  for (let i = 0; i < RESIDENTIAL_ELEMENT_COUNT; i++) {
    await expect(page.getByText(`Element ${i + 1} of ${RESIDENTIAL_ELEMENT_COUNT}`)).toBeVisible();
    await page.getByRole("button", { name: `${uniformDamagePct}%` }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  await expect(page.getByRole("heading", { name: "Exterior photo" })).toBeVisible();
  await page.getByLabel("Take exterior photo").setInputFiles(EXTERIOR_FIXTURE);
  await expect(page.locator("img[alt='Captured damage photo']")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Interior water depth")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Assessment notes")).toBeVisible();
  await page.getByLabel("Notes").fill(`Determination e2e run — ${uniformDamagePct}% uniform damage.`);
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Review and complete")).toBeVisible();
  const completeButton = page.getByRole("button", { name: "Complete assessment" });
  await expect(completeButton).toBeEnabled();
  await completeButton.click();

  await expect(page.getByRole("heading", { name: "Assessment complete" })).toBeVisible({ timeout: 10000 });

  const viewCalculation = page.getByRole("button", { name: "View calculation" });
  await expect(viewCalculation).toBeVisible({ timeout: 20000 });
  await viewCalculation.click();
  await expect(page).toHaveURL(/\/calculation\/[^/]+$/);

  const url = page.url();
  const segment = url.split("/calculation/")[1] ?? "";
  return decodeURIComponent(segment);
}

async function loginAsAssessorAndAttemptAdopt(browser: Browser, baseURL: string | undefined, clientId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaDevMagicLink(page, context.request, baseURL, ASSESSOR_EMAIL);
  const res = await context.request.post(`/api/determination/${encodeURIComponent(clientId)}/adopt`, {
    data: { confirmed: true },
  });
  await context.close();
  return res;
}

test.describe("T-C5 M4 determination + adoption workflow — the LT-3 chain", () => {
  test.describe.configure({ mode: "serial" });

  let admin: pg.Client;
  let notSdClientId: string;
  let borderlineClientId: string;
  let borderlineAssessmentId: string;
  let borderlineDeterminationId: string;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — pnpm test:determination needs riverline_test.");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("assessor captures two assessments (NOT_SD and BORDERLINE) and syncs", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, ASSESSOR_EMAIL);

    // 25% uniform damage on the TEST-FIXTURE cost table ($110/sqft total *
    // 1600 sqft practice structure * 0.25 = 44000; 44000/180000 = 0.2444 -> NOT_SD.
    notSdClientId = await captureFullAssessment(page, 25);

    // 50% uniform damage -> 88000/180000 = 0.4889 -> BORDERLINE.
    borderlineClientId = await captureFullAssessment(page, 50);

    // captureFullAssessment ends on /calculation/[clientId], which has no
    // "Log out" control (only /home does) — go there first.
    await page.goto("/home");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("official login -> review queue shows both, sorted BORDERLINE before NOT_SD", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);

    await page.goto("/determination");
    await expect(page.getByRole("heading", { name: "Determination queue" })).toBeVisible();

    const links = page.locator('a[href^="/determination/"]');
    const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    const notSdHref = `/determination/${encodeURIComponent(notSdClientId)}`;
    const borderlineHref = `/determination/${encodeURIComponent(borderlineClientId)}`;

    expect(hrefs).toContain(notSdHref);
    expect(hrefs).toContain(borderlineHref);
    expect(hrefs.indexOf(borderlineHref)).toBeLessThan(hrefs.indexOf(notSdHref));
  });

  test("review screen shows every input; empty-reason override is blocked with a designed error", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto(`/determination/${encodeURIComponent(borderlineClientId)}`);

    await expect(page.getByText("Borderline", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Market value used")).toBeVisible();
    await expect(page.getByText("Cost table version")).toBeVisible();
    await expect(page.getByText("Engine version")).toBeVisible();
    await expect(page.getByText("Foundations", { exact: true })).toBeVisible();

    // T-C7: captureFullAssessment only attaches the required exterior photo
    // (no per-element photos on this run), so the Photos section should
    // render exactly one grouped heading — "Exterior" — proving the review
    // screen actually groups by element_code rather than showing one flat
    // gallery (migrations/0004_photos_element_code.sql,
    // src/core/determination/pure.ts groupPhotosByElement).
    await expect(page.getByRole("heading", { name: "Exterior", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Override Foundations" }).click();
    await page.getByLabel("New damage percentage (0-100)").fill("90");
    await page.getByRole("button", { name: "Save override" }).click();

    await expect(page.getByText("A reason is required to save this override.")).toBeVisible();
  });

  test("override with a real reason: new calculations row inserted, audit_log entry written, old row untouched", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto(`/determination/${encodeURIComponent(borderlineClientId)}`);

    const assessmentRow = await admin.query(`select id from assessments where client_id = $1`, [borderlineClientId]);
    borderlineAssessmentId = assessmentRow.rows[0].id as string;
    const before = await admin.query(`select count(*)::int as n from calculations where assessment_id = $1`, [
      borderlineAssessmentId,
    ]);

    await page.getByRole("button", { name: "Override Foundations" }).click();
    await page.getByLabel("New damage percentage (0-100)").fill("90");
    await page
      .getByLabel("Reason for override (required)")
      .fill("Field re-inspection found more extensive foundation damage than initially recorded.");
    await page.getByRole("button", { name: "Save override" }).click();

    // Page refreshes with the new calculation reflected.
    await expect(page.getByText(/calculation #2 for this assessment/)).toBeVisible({ timeout: 10000 });

    const after = await admin.query(`select count(*)::int as n from calculations where assessment_id = $1`, [
      borderlineAssessmentId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);

    const audit = await admin.query(
      `select actor_user_id, after_json from audit_log
       where entity_type = 'assessment_element' and action = 'override_damage_pct'
       and (after_json->>'element_code') = 'foundations'
       order by at desc limit 1`,
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].after_json.damage_pct).toBe(90);
    expect(audit.rows[0].after_json.reason).toContain("Field re-inspection");
  });

  test("adopt attempt as assessor role is forbidden (403) — role guard proven, not just a hidden button", async ({
    browser,
    baseURL,
  }) => {
    const res = await loginAsAssessorAndAttemptAdopt(browser, baseURL, borderlineClientId);
    expect(res.status()).toBe(403);

    const det = await admin.query(
      `select count(*)::int as n from determinations d join calculations c on c.id = d.calculation_id where c.assessment_id = $1`,
      [borderlineAssessmentId],
    );
    expect(det.rows[0].n).toBe(0);
  });

  test("adopt requires explicit confirmation, then adopts — determinations row + audit chain (override + adoption) asserted via DB", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto(`/determination/${encodeURIComponent(borderlineClientId)}`);

    const adoptButton = page.getByRole("button", { name: "Adopt determination" });
    await expect(adoptButton).toBeVisible();
    await adoptButton.click();

    // Confirmation step — the button that actually adopts is a second,
    // distinct control, not the first tap.
    await expect(page.getByText("Confirm adoption")).toBeVisible();
    await page.getByRole("button", { name: "Yes, adopt this determination" }).click();

    await expect(page.getByText(/Adopted by official@example\.gov/)).toBeVisible({ timeout: 10000 });

    const detRes = await admin.query(
      `select d.id, d.status, d.adopted_at, u.email as adopted_by_email
       from determinations d
       join calculations c on c.id = d.calculation_id
       join users u on u.id = d.adopted_by_user_id
       where c.assessment_id = $1`,
      [borderlineAssessmentId],
    );
    expect(detRes.rows.length).toBe(1);
    expect(detRes.rows[0].status).toBe("adopted");
    expect(detRes.rows[0].adopted_at).not.toBeNull();
    expect(detRes.rows[0].adopted_by_email).toBe(OFFICIAL_EMAIL);
    borderlineDeterminationId = detRes.rows[0].id as string;

    // Full audit chain: the element override AND the adoption both appear,
    // in order.
    const auditChain = await admin.query(
      `select entity_type, action, at from audit_log
       where (entity_type = 'assessment_element' and entity_id in (select id from assessment_elements where assessment_id = $1))
          or (entity_type = 'determination' and entity_id = $2)
       order by at asc`,
      [borderlineAssessmentId, borderlineDeterminationId],
    );
    const actions = auditChain.rows.map((r) => `${r.entity_type}:${r.action}`);
    expect(actions).toContain("assessment_element:override_damage_pct");
    expect(actions).toContain("determination:INSERT");
    expect(actions.indexOf("assessment_element:override_damage_pct")).toBeLessThan(actions.indexOf("determination:INSERT"));
  });

  test("supersede flow: old row -> superseded (never deleted), new draft determination created", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto(`/determination/${encodeURIComponent(borderlineClientId)}`);

    await page.getByRole("button", { name: "Supersede this determination" }).click();
    await expect(page.getByText("Supersede this determination", { exact: false }).first()).toBeVisible();
    await page.getByLabel("Reason for superseding (required)").fill("Owner appeal produced new evidence.");
    await page.getByRole("button", { name: "Yes, supersede this determination" }).click();

    // The page re-renders (router.refresh()) showing the NEW draft
    // determination for this same assessment — its "Adopt determination"
    // button reappearing is the real signal the supersede write landed,
    // not just that the click event fired.
    await expect(page.getByRole("button", { name: "Adopt determination" })).toBeVisible({ timeout: 10000 });

    const oldRow = await admin.query(`select status from determinations where id = $1`, [borderlineDeterminationId]);
    expect(oldRow.rows.length).toBe(1); // still exists — never deleted
    expect(oldRow.rows[0].status).toBe("superseded");

    const newRow = await admin.query(
      `select d.id, d.status from determinations d join calculations c on c.id = d.calculation_id
       where c.assessment_id = $1 and d.id <> $2`,
      [borderlineAssessmentId, borderlineDeterminationId],
    );
    expect(newRow.rows.length).toBe(1);
    expect(newRow.rows[0].status).toBe("draft");
  });
});
