import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// T-A1 determination letters — the refusal-state e2e. Proves:
//   1. THE HEADLINE FEATURE: an adopted, definite determination in a
//      jurisdiction whose ordinance_citation is NULL (the real state of
//      every jurisdiction seeded by scripts/db/seed.mjs — riverline_test
//      included, same seeding logic as riverline_dev) shows the designed
//      refusal state, and creates NO letters row.
//   2. An admin entering the ordinance citation (via the in-page form)
//      unblocks generation — the letter preview then renders the entered
//      text.
//   3. Issuing creates the permanent record (letters row + audit +
//      determinations.letter_id link).
//   4. Print-CSS correctness under `page.emulateMedia({ media: 'print' })`
//      (docs/design/direction.md -> "Print": black on white, no background
//      fills).
//   5. Role guard: assessor cannot enter a citation or issue a letter.
//
// Run via a dedicated harness (see docs/journal/2026-08-17-a1-letters.md):
// a `next dev` instance on PORT 3400, pointed at riverline_test (seeded
// with the TEST-FIXTURE cost table), never touching ports 3000/3100/3200/3300.
const ASSESSOR_EMAIL = "assessor@example.gov";
const OFFICIAL_EMAIL = "official@example.gov";
const ADMIN_EMAIL = "admin@example.gov";
const PRACTICE_ADDRESS = "123 Practice Ln";
const RESIDENTIAL_ELEMENT_COUNT = 12;
const TEST_CITATION = "TEST ORDINANCE §00-000 — fixture, not legal text";

// Default matches the determination gate's server (this spec runs under
// playwright.determination.config.ts / `pnpm test:determination`); the
// A1_BASE_URL override preserves the isolated port-3400 run documented in
// docs/journal/2026-08-17-a1-letters.md.
const BASE_URL = process.env.A1_BASE_URL ?? process.env.DETERMINATION_BASE_URL ?? "http://localhost:3100";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTERIOR_FIXTURE = path.resolve(__dirname, "../fixtures/photos/sample-exterior.jpg");

async function loginViaDevMagicLink(page: Page, request: APIRequestContext, email: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email address").pressSequentially(email);
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(/sign-in link was sent/i);

  const linkResponse = await request.get(`${BASE_URL}/api/dev/magic-link?email=${encodeURIComponent(email)}`);
  expect(linkResponse.ok()).toBe(true);
  const { url } = (await linkResponse.json()) as { url: string };
  await page.goto(new URL(url, BASE_URL).toString());
  await expect(page).toHaveURL(/\/home$/);
}

async function logout(page: Page) {
  await page.goto(`${BASE_URL}/home`);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** 25% uniform damage on the TEST-FIXTURE cost table -> a definite NOT_SD
 * ratio (0.2444, well clear of the borderline band) — same recipe
 * test/e2e/determination.spec.ts already verified. */
async function captureNotSdAssessment(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/registry`);
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
    await page.getByRole("button", { name: "25%" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  await expect(page.getByRole("heading", { name: "Exterior photo" })).toBeVisible();
  await page.getByLabel("Take exterior photo").setInputFiles(EXTERIOR_FIXTURE);
  await expect(page.locator("img[alt='Captured damage photo']")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Interior water depth")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Assessment notes")).toBeVisible();
  await page.getByLabel("Notes").fill("A1 letters e2e run — 25% uniform damage, NOT_SD.");
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

async function adoptViaUi(page: Page, clientId: string) {
  await page.goto(`${BASE_URL}/determination/${encodeURIComponent(clientId)}`);
  const adoptButton = page.getByRole("button", { name: "Adopt determination" });
  await expect(adoptButton).toBeVisible();
  await adoptButton.click();
  await expect(page.getByText("Confirm adoption")).toBeVisible();
  await page.getByRole("button", { name: "Yes, adopt this determination" }).click();
  await expect(page.getByText(new RegExp(`Adopted by ${OFFICIAL_EMAIL}`))).toBeVisible({ timeout: 10000 });
}

test.describe("T-A1 determination letters — honest refusal state + issue flow", () => {
  test.describe.configure({ mode: "serial" });

  let admin: pg.Client;
  let clientId: string;
  let assessmentId: string;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — this spec needs riverline_test (see docs/journal entry).");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();

    // Demo City is the shared practice jurisdiction every e2e spec in this
    // repo captures against (scripts/db/seed.mjs). Its ordinance_citation
    // starts NULL in a fresh seed, but a prior run of THIS spec leaves it
    // set (that is the point of the "admin enters it" test). Reset it here
    // so the refusal-state assertion below reflects the real, honest
    // default rather than a stale citation left over from an earlier run —
    // this module (src/modules/a1-letters/actions.ts) is the only code
    // path anywhere that ever sets ordinance_citation, so resetting it is
    // safe with respect to every other concurrently-running spec.
    await admin.query(
      `update jurisdictions set ordinance_citation = null,
         letterhead_config = letterhead_config - 'appeal_window_days'
       where name = 'Demo City'`,
    );
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("setup: assessor captures a definite NOT_SD assessment, syncs, and official adopts it", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, ASSESSOR_EMAIL);
    clientId = await captureNotSdAssessment(page);
    await logout(page);

    await loginViaDevMagicLink(page, request, OFFICIAL_EMAIL);
    await adoptViaUi(page, clientId);

    const row = await admin.query(`select id from assessments where client_id = $1`, [clientId]);
    assessmentId = row.rows[0].id as string;

    const det = await admin.query(
      `select status from determinations d join calculations c on c.id = d.calculation_id where c.assessment_id = $1`,
      [assessmentId],
    );
    expect(det.rows[0].status).toBe("adopted");
  });

  test("THE REFUSAL STATE: /letters/[clientId] refuses explicitly (ordinance_citation is null), and creates no letters row", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, OFFICIAL_EMAIL);

    const before = await admin.query(`select count(*)::int as n from letters`);

    await page.goto(`${BASE_URL}/letters/${encodeURIComponent(clientId)}`);
    await expect(page.getByText("Letter generation unavailable")).toBeVisible();
    await expect(page.getByText(/ordinance citation has not been entered/)).toBeVisible();
    await expect(page.getByText("docs/BLOCKERS.md")).toBeVisible();

    const after = await admin.query(`select count(*)::int as n from letters`);
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const jur = await admin.query(
      `select j.ordinance_citation from jurisdictions j
       join structures s on s.jurisdiction_id = j.id
       join assessments a on a.structure_id = s.id
       where a.id = $1`,
      [assessmentId],
    );
    expect(jur.rows[0].ordinance_citation).toBeNull();
  });

  test("role guard: an assessor cannot enter the ordinance citation or issue a letter", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, ASSESSOR_EMAIL);

    // page.request (not the bare `request` fixture) shares the browsing
    // context's cookie jar, so these POSTs carry the assessor's real
    // session cookie — proving the role guard actually rejects an
    // authenticated-but-wrong-role request (403), not just an
    // unauthenticated one (401).
    const ordinanceRes = await page.request.post(`${BASE_URL}/letters/${encodeURIComponent(clientId)}/ordinance`, {
      data: { ordinanceCitation: TEST_CITATION, appealWindowDays: 30 },
    });
    expect(ordinanceRes.status()).toBe(403);

    const issueRes = await page.request.post(`${BASE_URL}/letters/${encodeURIComponent(clientId)}/issue`);
    expect(issueRes.status()).toBe(403);

    await logout(page);
  });

  test("admin enters the ordinance citation via the form -> refusal clears, letter preview renders the entered text", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, ADMIN_EMAIL);
    await page.goto(`${BASE_URL}/letters/${encodeURIComponent(clientId)}`);

    await expect(page.getByText("Letter generation unavailable")).toBeVisible();
    await page.getByLabel("Ordinance citation (verbatim, required)").fill(TEST_CITATION);
    await page.getByLabel("Appeal window (days) — optional").fill("30");
    await page.getByRole("button", { name: "Save ordinance citation" }).click();

    await expect(page.getByRole("button", { name: "Issue letter" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Letter generation unavailable")).toHaveCount(0);

    const jur = await admin.query(
      `select j.ordinance_citation from jurisdictions j
       join structures s on s.jurisdiction_id = j.id
       join assessments a on a.structure_id = s.id
       where a.id = $1`,
      [assessmentId],
    );
    expect(jur.rows[0].ordinance_citation).toBe(TEST_CITATION);

    const audit = await admin.query(
      `select action from audit_log where entity_type = 'jurisdiction' and action = 'set_ordinance_and_letterhead' order by at desc limit 1`,
    );
    expect(audit.rows.length).toBe(1);

    // The preview iframe (served by app/letters/[clientId]/print/route.ts)
    // renders the citation text verbatim, and the SD/NOT_SD statement.
    const frame = page.frameLocator("iframe[title='Letter preview']");
    await expect(frame.getByText(TEST_CITATION)).toBeVisible();
    await expect(frame.getByText(/IS NOT substantially damaged/)).toBeVisible();
  });

  test("issue letter: creates the permanent record, links determinations.letter_id, audits", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, OFFICIAL_EMAIL);
    await page.goto(`${BASE_URL}/letters/${encodeURIComponent(clientId)}`);

    await page.getByRole("button", { name: "Issue letter" }).click();
    await expect(page.getByText("Confirm issue letter")).toBeVisible();
    await page.getByRole("button", { name: "Yes, issue this letter" }).click();

    await expect(page.getByText(/^Issued /)).toBeVisible({ timeout: 10000 });

    const det = await admin.query(
      `select d.letter_id from determinations d join calculations c on c.id = d.calculation_id where c.assessment_id = $1`,
      [assessmentId],
    );
    expect(det.rows[0].letter_id).not.toBeNull();

    const letter = await admin.query(`select template_version, pdf_storage_key, issued_at from letters where id = $1`, [
      det.rows[0].letter_id,
    ]);
    expect(letter.rows.length).toBe(1);
    expect(letter.rows[0].pdf_storage_key).toContain("letters/");
    expect(letter.rows[0].issued_at).not.toBeNull();

    const audit = await admin.query(
      `select actor_user_id from audit_log where entity_type = 'letter' and action = 'issue' and entity_id = $1`,
      [det.rows[0].letter_id],
    );
    expect(audit.rows.length).toBe(1);
  });

  test("print stylesheet: black on white, no background fills, under emulateMedia('print')", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, OFFICIAL_EMAIL);
    await page.goto(`${BASE_URL}/letters/${encodeURIComponent(clientId)}/print`);
    await expect(page.getByText(TEST_CITATION)).toBeVisible();
    await expect(page.getByText(/IS NOT substantially damaged/)).toBeVisible();
    await expect(page.getByText(/calculation and documentation aid/)).toBeVisible();

    await page.emulateMedia({ media: "print" });

    const bodyStyle = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { color: s.color, background: s.backgroundColor };
    });
    expect(bodyStyle.color).toBe("rgb(0, 0, 0)");
    expect(bodyStyle.background).toBe("rgb(255, 255, 255)");

    // Screen-only chrome (preview banner / print button) must not print.
    const previewBannerDisplay = await page.evaluate(() => {
      const el = document.querySelector(".previewBanner");
      return el ? getComputedStyle(el).display : "not-present";
    });
    expect(["none", "not-present"]).toContain(previewBannerDisplay);
  });
});
