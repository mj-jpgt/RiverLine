import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// T-W5 admin console — the real gap this task closes: the app READ
// cost_tables but nothing wrote them except test harnesses, so on a real
// deployment the 50%-rule calculation could never run. This spec proves,
// against a real dev server and real Postgres (riverline_test), the full
// chain: /admin starts honestly NOT SET -> an assessor captures an
// assessment that dead-ends at "no cost table loaded" -> an admin loads a
// real cost table through the real form (numbers typed directly below, not
// imported from test/fixtures/) -> the readiness panel flips to OK -> the
// SAME earlier assessment now produces a real calculation -> the admin
// sets the ordinance citation + appeal window -> an assessor gets 403 on
// both admin API routes.
//
// Runs via a dedicated harness (scripts/test-admin.mjs, PORT 3900) against
// a FRESH, uniquely-named jurisdiction seeded with zero cost_tables rows —
// see playwright.admin.config.ts's file header for why this can't share
// riverline_dev or the other gates' riverline_test jurisdiction.
const ADMIN_EMAIL = requireEnv("ADMIN_EMAIL_ADMIN");
const ASSESSOR_EMAIL = requireEnv("ADMIN_EMAIL_ASSESSOR");
const OFFICIAL_EMAIL = requireEnv("ADMIN_EMAIL_OFFICIAL");
const PRACTICE_ADDRESS = requireEnv("ADMIN_PRACTICE_ADDRESS");
const RESIDENTIAL_ELEMENT_COUNT = 12;

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://localhost:3900";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTERIOR_FIXTURE = path.resolve(__dirname, "../fixtures/photos/sample-exterior.jpg");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set — this spec must run via \`pnpm test:admin\` (scripts/test-admin.mjs).`);
  }
  return v;
}

// Operator-chosen dollar figures for THIS run only, typed directly here —
// deliberately NOT the test/fixtures/engine/cost-table.test-fixture-v0.json
// values, to prove the admin form itself (not a shared fixture) is what
// gets exercised. Obviously-synthetic, round numbers; no relation to any
// real FEMA/vendor cost guide (docs/BLOCKERS.md B1).
// Keys are the EXACT element display names from src/core/capture/elements.ts
// (RESIDENTIAL_ELEMENTS / NON_RESIDENTIAL_ELEMENTS "name" field, verbatim
// FEMA P-784 Table 3-6 / 3-8 wording) — these are also the exact accessible
// label text CostTableForm.tsx renders ("<name> (residential)" / "<name>
// (non-residential)"), so this map doubles as the source of truth for both
// the values entered and the labels used to enter them.
const RESIDENTIAL_COSTS: Record<string, string> = {
  Foundations: "11",
  Superstructure: "22",
  "Roof covering": "9",
  "Exterior finish": "7",
  "Interior finish": "13",
  "Doors and windows": "8",
  "Cabinets and countertops": "6",
  "Floor finish": "10",
  Plumbing: "12",
  Electrical: "11",
  Appliances: "5",
  HVAC: "9",
};
const NON_RESIDENTIAL_COSTS: Record<string, string> = {
  Foundations: "13",
  Superstructure: "26",
  "Roof covering": "10",
  Plumbing: "13",
  Electrical: "12",
  Interiors: "15",
  HVAC: "10",
};
const COST_TABLE_VERSION = `W5-ADMIN-E2E-COST-TABLE-${Date.now()}`;
const COST_TABLE_CITATION = "W5 admin e2e run — operator-entered test guide, edition 2026, p. 1 (not a real source).";
const APPEAL_WINDOW_DAYS = "45";
const TEST_CITATION = "TEST ORDINANCE §00-000 — W5 admin e2e fixture, not legal text.";

/** Navigates to /login, retrying a couple of times if the dev server
 * returns a transient non-200 (this repo's shared-working-tree convention,
 * docs/agents/SUBAGENT.md, means another agent's concurrent file save can
 * trigger a Next.js Fast-Refresh full reload mid-request on a shared
 * `.next` build — observed directly during this task's own gate runs).
 * Not masking a real regression: a genuine broken /login would still fail
 * every retry and the final assertion below. */
async function gotoResilient(page: Page, path: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await page.goto(`${BASE_URL}${path}`);
    if (response && response.ok()) return;
    await page.waitForTimeout(1500);
  }
}

/** Fills the email field and waits for the submit button to enable. A
 * concurrent agent's file save landing mid-type can trigger a Next.js
 * Fast-Refresh full reload that wipes the in-progress form state (observed
 * directly during this task's gate runs, alongside the transient /login
 * 404s gotoResilient guards against) — this resolves false when that
 * happens instead of hanging the full 15s, so the caller can re-navigate
 * and retype from a clean page rather than typing into a page that no
 * longer exists. */
async function fillEmailAndWaitEnabled(page: Page, email: string): Promise<boolean> {
  await page.getByLabel("Email address").pressSequentially(email);
  try {
    await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 25000 });
    return true;
  } catch {
    return false;
  }
}

/** Submits the sign-in form (assumes the email field is already filled and
 * the button enabled) and waits for EITHER the "sent" status or a visible
 * error. Returns which one happened, rather than hanging on a bare
 * `toHaveText` until the outer timeout — a transient server error under
 * this shared, heavily-loaded environment (see gotoResilient's comment)
 * showed up here directly during this task's gate runs ("Something went
 * wrong. Try again.", not a real product bug — the request-link route
 * itself is proven by test/unit and by direct HTTP checks during this same
 * run). */
async function submitAndCheckOutcome(page: Page): Promise<"sent" | "error" | "neither"> {
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const sent = page.getByRole("status").filter({ hasText: /sign-in link was sent/i });
  const error = page.getByText(/something went wrong|network error/i);
  try {
    await Promise.race([
      sent.waitFor({ state: "visible", timeout: 25000 }),
      error.waitFor({ state: "visible", timeout: 25000 }),
    ]);
  } catch {
    return "neither";
  }
  if (await sent.isVisible()) return "sent";
  if (await error.isVisible()) return "error";
  return "neither";
}

async function loginViaDevMagicLink(page: Page, request: APIRequestContext, email: string) {
  // The whole request-a-link -> fetch-it-back cycle is retried together
  // (not just the GET): the dev-link-store is a per-email FIFO queue keyed
  // to the exact POST that pushed an entry, so retrying only the GET after
  // a failure can't manufacture an entry that was never pushed (or was
  // already drained) — observed directly during this task's gate runs (a
  // POST that logged success followed immediately by a 404 GET, a rare
  // race in this shared, heavily-loaded environment, not a reproducible
  // product bug — the queue mechanics themselves are covered by
  // src/core/auth/dev-link-store.ts's own design and by every other
  // e2e spec in this codebase using the identical pattern successfully).
  let url: string | null = null;
  for (let attempt = 1; attempt <= 4 && !url; attempt++) {
    await gotoResilient(page, "/login");
    const ready = await fillEmailAndWaitEnabled(page, email);
    if (!ready) continue;
    const outcome = await submitAndCheckOutcome(page);
    if (outcome !== "sent") continue;
    const linkResponse = await request.get(`${BASE_URL}/api/dev/magic-link?email=${encodeURIComponent(email)}`);
    if (!linkResponse.ok()) continue;
    url = ((await linkResponse.json()) as { url: string }).url;
  }
  // Real assertion — if every retry above hit the same transient failure,
  // this is where a genuine regression surfaces instead of being silently
  // swallowed.
  expect(url, "never obtained a pending magic-link URL after retries").not.toBeNull();
  const verifyUrl = new URL(url as string, BASE_URL).toString();
  // The verify route 307-redirects immediately; under this environment's
  // load a fast redirect chain occasionally surfaces as a transient
  // net::ERR_ABORTED from Playwright even though the server-side redirect
  // already completed (observed directly during this task's gate runs).
  // The token is SINGLE-USE (verifyMagicLink marks it used on first
  // success), so this must NOT retry the same navigation blindly — that
  // would hit "invalid_token" on the second attempt for a token the first
  // attempt actually consumed. Instead: on a thrown navigation error,
  // check where the page actually ended up before deciding anything is
  // wrong.
  try {
    await page.goto(verifyUrl);
  } catch {
    // Swallow — the URL check right below is the real signal, not the
    // exception (a same-document redirect racing the "load" event is a
    // known source of a spurious net::ERR_ABORTED here).
  }
  await expect(page).toHaveURL(/\/home$/, { timeout: 25000 });
}

async function logout(page: Page) {
  await gotoResilient(page, "/home");
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (/\/login$/.test(page.url())) return; // already logged out — a prior slow attempt landed after all
    await page.getByRole("button", { name: "Log out" }).click();
    try {
      await expect(page).toHaveURL(/\/login$/, { timeout: 25000 });
      return;
    } catch {
      // Generous retry: under this environment's load, the logout form's
      // full-page POST navigation has occasionally taken longer than one
      // 15s window to land (cold compile of /api/auth/logout, observed
      // directly during this task's gate runs) — re-navigate to /home
      // (which itself redirects straight to /login if the session already
      // cleared) and re-check before trying the click again.
      if (attempt < 3) await gotoResilient(page, "/home");
    }
  }
  await expect(page).toHaveURL(/\/login$/, { timeout: 25000 });
}

/** Captures a full 12-element residential assessment (25% uniform damage)
 * on the seeded practice structure and returns the resulting clientId, read
 * off the /calculation/[clientId] URL the post-sync "View calculation"
 * button navigates to — same recipe test/e2e/determination.spec.ts and
 * test/e2e/a1-letters.spec.ts already use. */
async function captureAssessment(page: Page): Promise<string> {
  await gotoResilient(page, "/registry");
  const resultLink = page.getByRole("link", { name: new RegExp(PRACTICE_ADDRESS) });
  // RegistrySearch is a "use client" component with a fully controlled
  // input (value={query}); direct backend checks during this task's gate
  // runs proved /api/registry/search itself returns the right row
  // instantly for this exact query, and every prior attempt's DOM snapshot
  // showed the typed text sitting in the box while the panel stayed on its
  // pre-hydration default ("idle") — the classic SSR hydration race: React
  // does not clobber a form element's DOM value once a user has already
  // typed into it, but if hydration attaches its onChange listener AFTER
  // that happens, the `query` state itself never updates, so the debounced
  // search effect never fires. `page.waitForLoadState("networkidle")`
  // waits out the page's own hydration-triggered requests before typing,
  // which the earlier network-request-driven waits in this spec (login,
  // logout) didn't need since they don't touch a controlled input this
  // early after navigation.
  let found = false;
  for (let attempt = 1; attempt <= 3 && !found; attempt++) {
    if (attempt > 1) await gotoResilient(page, "/registry");
    await page.waitForLoadState("networkidle").catch(() => {});
    const searchInput = page.getByLabel("Address");
    await searchInput.click();
    await searchInput.fill(PRACTICE_ADDRESS);
    found = await resultLink
      .waitFor({ state: "visible", timeout: 12000 })
      .then(() => true)
      .catch(() => false);
  }
  await expect(resultLink).toBeVisible({ timeout: 25000 });
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
  await expect(page.locator("img[alt='Captured damage photo']")).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Interior water depth")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Assessment notes")).toBeVisible();
  await page.getByLabel("Notes").fill("W5 admin e2e run — 25% uniform damage, captured before any cost table existed.");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByText("Review and complete")).toBeVisible();
  const completeButton = page.getByRole("button", { name: "Complete assessment" });
  await expect(completeButton).toBeEnabled();
  await completeButton.click();

  await expect(page.getByRole("heading", { name: "Assessment complete" })).toBeVisible({ timeout: 25000 });

  const viewCalculation = page.getByRole("button", { name: "View calculation" });
  await expect(viewCalculation).toBeVisible({ timeout: 25000 });
  await viewCalculation.click();
  await expect(page).toHaveURL(/\/calculation\/[^/]+$/);

  const url = page.url();
  const segment = url.split("/calculation/")[1] ?? "";
  return decodeURIComponent(segment);
}

test.describe("T-W5 admin console — cost tables, jurisdiction settings, readiness", () => {
  test.describe.configure({ mode: "serial" });

  let admin: pg.Client;
  let jurisdictionId: string;
  let clientId: string;
  let assessmentId: string;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — this spec needs riverline_test (see scripts/test-admin.mjs).");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    const u = await admin.query(`select jurisdiction_id from users where email = $1`, [ADMIN_EMAIL]);
    jurisdictionId = u.rows[0].jurisdiction_id as string;
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("readiness starts NOT SET, and both admin API routes 403 a non-admin session", async ({ page, request }) => {
    await loginViaDevMagicLink(page, request, ADMIN_EMAIL);
    await gotoResilient(page, "/admin");
    await expect(page.getByRole("heading", { name: "Jurisdiction readiness" })).toBeVisible();
    await expect(page.getByText("NOT SET")).toHaveCount(3);
    await expect(page.getByText(/Calculations cannot run/)).toBeVisible();
    await expect(page.getByText(/Letters cannot be issued/)).toBeVisible();
    await logout(page);

    await loginViaDevMagicLink(page, request, ASSESSOR_EMAIL);
    const costTableRes = await page.request.post(`${BASE_URL}/api/admin/cost-tables`, {
      data: {
        version: "should-be-rejected",
        sourceCitation: "irrelevant, should never be validated — role check comes first",
        effectiveDateIso: "2026-08-17",
        payload: { residential: {}, non_residential: {} },
      },
    });
    expect(costTableRes.status()).toBe(403);

    const jurisdictionRes = await page.request.post(`${BASE_URL}/api/admin/jurisdiction`, {
      data: { ordinanceCitation: TEST_CITATION, appealWindowDays: null, letterheadName: null, addressLines: null, iccText: null },
    });
    expect(jurisdictionRes.status()).toBe(403);
    await logout(page);
  });

  test("assessor captures an assessment before any cost table exists -> calculation shows the honest blocked state", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, ASSESSOR_EMAIL);
    clientId = await captureAssessment(page);
    await expect(page.getByRole("heading", { name: "No cost table loaded" })).toBeVisible();
    await expect(page.getByText("docs/BLOCKERS.md B1")).toBeVisible();
    await logout(page);

    const row = await admin.query(`select id from assessments where client_id = $1`, [clientId]);
    assessmentId = row.rows[0].id as string;
    const calcCount = await admin.query(`select count(*)::int as n from calculations where assessment_id = $1`, [
      assessmentId,
    ]);
    expect(calcCount.rows[0].n).toBe(0);
  });

  test("admin loads a cost table via the form -> readiness flips to OK -> the earlier assessment now computes", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, ADMIN_EMAIL);

    await gotoResilient(page, "/admin/cost-tables");
    await expect(page.getByText(/No cost table loaded yet/)).toBeVisible();

    await page.getByLabel("Version label (required)").fill(COST_TABLE_VERSION);
    await page.getByLabel(/Source citation \(required\)/).fill(COST_TABLE_CITATION);
    await page.getByLabel("Effective date (required)").fill("2026-08-17");

    for (const [name, value] of Object.entries(RESIDENTIAL_COSTS)) {
      await page.getByLabel(`${name} (residential)`).fill(value);
    }
    for (const [name, value] of Object.entries(NON_RESIDENTIAL_COSTS)) {
      await page.getByLabel(`${name} (non-residential)`).fill(value);
    }

    await page.getByRole("button", { name: "Save cost table" }).click();
    await expect(page.getByText(`Cost table "${COST_TABLE_VERSION}" saved.`)).toBeVisible({ timeout: 25000 });

    // DB assertions: exactly one new row, audited, jurisdiction-scoped.
    const ctRow = await admin.query(
      `select jurisdiction_id, source_citation, effective_date from cost_tables where version = $1`,
      [COST_TABLE_VERSION],
    );
    expect(ctRow.rows.length).toBe(1);
    expect(ctRow.rows[0].source_citation).toBe(COST_TABLE_CITATION);

    const audit = await admin.query(
      `select action from audit_log where entity_type = 'cost_table' and after_json->>'version' = $1`,
      [COST_TABLE_VERSION],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].action).toBe("insert");

    // Readiness panel: OK now, with the active version named.
    await gotoResilient(page, "/admin");
    await expect(page.getByText(`OK, active version ${COST_TABLE_VERSION}`)).toBeVisible();

    // The SAME earlier assessment — blocked before — now produces a real
    // calculation on revisit (no calculations row existed yet, so the page
    // still auto-computes on view; app/calculation/[clientId]/page.tsx).
    await gotoResilient(page, `/calculation/${encodeURIComponent(clientId)}`);
    await expect(page.getByText("Damage-to-value ratio")).toBeVisible({ timeout: 25000 });
    await expect(page.getByText("No cost table loaded")).toHaveCount(0);

    const calcRow = await admin.query(
      `select cost_table_version, threshold_result from calculations where assessment_id = $1`,
      [assessmentId],
    );
    expect(calcRow.rows.length).toBe(1);
    expect(calcRow.rows[0].cost_table_version).toBe(COST_TABLE_VERSION);

    await logout(page);
  });

  test("admin sets ordinance citation + appeal window -> readiness flips to OK -> letters refusal state clears once adopted", async ({
    page,
    request,
  }) => {
    await loginViaDevMagicLink(page, request, ADMIN_EMAIL);
    await gotoResilient(page, "/admin/jurisdiction");

    await page.getByLabel("Ordinance citation (verbatim, required)").fill(TEST_CITATION);
    await page.getByLabel(/Appeal window \(days\)/).fill(APPEAL_WINDOW_DAYS);
    await page.getByRole("button", { name: "Save jurisdiction settings" }).click();
    await expect(page.getByText("Jurisdiction settings saved.")).toBeVisible({ timeout: 25000 });

    const jur = await admin.query(`select ordinance_citation, letterhead_config from jurisdictions where id = $1`, [
      jurisdictionId,
    ]);
    expect(jur.rows[0].ordinance_citation).toBe(TEST_CITATION);
    expect(jur.rows[0].letterhead_config.appeal_window_days).toBe(45);

    const audit = await admin.query(
      `select action from audit_log where entity_type = 'jurisdiction' and action = 'admin_update_settings' and jurisdiction_id = $1 order by at desc limit 1`,
      [jurisdictionId],
    );
    expect(audit.rows.length).toBe(1);

    await gotoResilient(page, "/admin");
    await expect(page.getByText("OK, on file")).toBeVisible();
    await expect(page.getByText("OK, configured")).toBeVisible();
    await logout(page);

    // Adopt the determination (official role) so /letters/[clientId] has
    // something to render, then confirm it is NOT the refusal state —
    // the citation this test just entered is what unblocks it.
    await loginViaDevMagicLink(page, request, OFFICIAL_EMAIL);
    await gotoResilient(page, `/determination/${encodeURIComponent(clientId)}`);
    const adoptButton = page.getByRole("button", { name: "Adopt determination" });
    await expect(adoptButton).toBeVisible();
    await adoptButton.click();
    await expect(page.getByText("Confirm adoption")).toBeVisible();
    await page.getByRole("button", { name: "Yes, adopt this determination" }).click();
    await expect(page.getByText(new RegExp(`Adopted by ${OFFICIAL_EMAIL}`))).toBeVisible({ timeout: 25000 });

    await gotoResilient(page, `/letters/${encodeURIComponent(clientId)}`);
    await expect(page.getByText("Letter generation unavailable")).toHaveCount(0);
    const frame = page.frameLocator("iframe[title='Letter preview']");
    await expect(frame.getByText(TEST_CITATION)).toBeVisible();
  });
});
