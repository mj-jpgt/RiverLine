import pg from "pg";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// T-G3 team user management — THE GAP this closes: before this task, the
// only way to create a `users` row anywhere in this codebase was a seed
// script, so an emergency manager had no way to onboard an inspector. This
// spec proves, against a real dev server and real Postgres (riverline_test):
// an admin adds a team member through the real form -> generates a
// one-time sign-in link on demand (no email transport required,
// docs/BLOCKERS.md B4) -> a brand-new browser context (nobody's session,
// nobody's cookies) uses that link and lands signed in with the correct
// role -> the admin deactivates them -> their already-open session is
// rejected on its next request to the admin/users surface (requireActiveRole,
// src/core/auth/role-guard.ts), AND their account can never sign in again
// (requestMagicLink silently refuses a deactivated email,
// src/core/auth/magic-link.ts).
//
// Runs via a dedicated harness (scripts/test-users.mjs, PORT 4900) against
// a FRESH, uniquely-named jurisdiction seeded with exactly one admin —
// see playwright.users.config.ts's header for why this can't share
// riverline_test's other gates' jurisdictions.
const ADMIN_EMAIL = requireEnv("USERS_EMAIL_ADMIN");

const BASE_URL = process.env.USERS_BASE_URL ?? "http://localhost:4900";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set — this spec must run via \`pnpm test:users\` (scripts/test-users.mjs).`);
  }
  return v;
}

/** Same resilience helpers test/e2e/admin.spec.ts already established for
 * this repo's shared-working-tree convention (docs/agents/SUBAGENT.md):
 * a concurrent agent's file save can trigger a Next.js Fast-Refresh full
 * reload mid-request. */
async function gotoResilient(page: Page, path: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await page.goto(`${BASE_URL}${path}`);
    if (response && response.ok()) return;
    await page.waitForTimeout(1500);
  }
}

async function fillEmailAndWaitEnabled(page: Page, email: string): Promise<boolean> {
  await page.getByLabel("Email address").pressSequentially(email);
  try {
    await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 25000 });
    return true;
  } catch {
    return false;
  }
}

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
  expect(url, "never obtained a pending magic-link URL after retries").not.toBeNull();
  const verifyUrl = new URL(url as string, BASE_URL).toString();
  try {
    await page.goto(verifyUrl);
  } catch {
    // Swallow — the URL assertion below is the real signal (redirect race,
    // same documented behavior test/e2e/admin.spec.ts relies on).
  }
  await expect(page).toHaveURL(/\/home$/, { timeout: 25000 });
}

test.describe("T-G3 team user management — no-email onboarding, deactivation lockout", () => {
  test.describe.configure({ mode: "serial" });

  let db: pg.Client;
  let jurisdictionId: string;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — this spec needs riverline_test (see scripts/test-users.mjs).");
    }
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const u = await db.query(`select jurisdiction_id from users where email = $1`, [ADMIN_EMAIL]);
    jurisdictionId = u.rows[0].jurisdiction_id as string;
  });

  test.afterAll(async () => {
    await db.end();
  });

  test("admin adds a team member, generates a sign-in link, a new browser context uses it and lands with the correct role, then deactivation locks the account out", async ({
    page,
    request,
    browser,
  }) => {
    const runId = Date.now();
    const newAdminEmail = `g3-users-e2e-teammate-${runId}@example.gov`;

    // --- admin logs in, sees the starting roster (just themselves) ---
    await loginViaDevMagicLink(page, request, ADMIN_EMAIL);
    await gotoResilient(page, "/admin/users");
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    const adminRow = page.getByRole("row", { name: new RegExp(ADMIN_EMAIL) });
    await expect(adminRow).toBeVisible();
    await expect(adminRow.getByText("(you)")).toBeVisible();

    // Plain-language role descriptions are on the page (task requirement:
    // "who should get assessor vs official vs viewer").
    await expect(page.getByText(/Field role\./)).toBeVisible();
    await expect(page.getByText(/Review role\./)).toBeVisible();
    await expect(page.getByText(/Read-only\./)).toBeVisible();

    // --- add a team member through the real form ---
    await page.getByLabel("Email address (required)").fill(newAdminEmail);
    await page.getByRole("radio", { name: "Administrator" }).check();
    await page.getByRole("button", { name: "Add team member" }).click();
    await expect(page.getByText(new RegExp(`${newAdminEmail} was added`))).toBeVisible({ timeout: 25000 });
    await expect(page.getByRole("row", { name: new RegExp(newAdminEmail) })).toBeVisible();

    // --- generate a one-time sign-in link on demand (no email transport) ---
    const newRow = page.getByRole("row", { name: new RegExp(newAdminEmail) });
    await newRow.getByRole("button", { name: "Create sign-in link" }).click();
    const linkInput = page.getByLabel(`Sign-in link URL for ${newAdminEmail}`);
    await expect(linkInput).toBeVisible({ timeout: 25000 });
    const signInUrl = await linkInput.inputValue();
    expect(signInUrl).toContain("/api/auth/verify?token=");

    // --- a BRAND NEW browser context (no cookies, nobody's session) uses it ---
    const teammateContext = await browser.newContext();
    const teammatePage = await teammateContext.newPage();
    try {
      await teammatePage.goto(signInUrl);
    } catch {
      // Same redirect-race tolerance as loginViaDevMagicLink above.
    }
    await expect(teammatePage).toHaveURL(/\/home$/, { timeout: 25000 });

    // Lands with the correct role: this account was created as
    // "Administrator", so it can reach the admin-only team screen and see
    // the same jurisdiction's roster.
    await gotoResilient(teammatePage, "/admin/users");
    await expect(teammatePage.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(teammatePage.getByText(ADMIN_EMAIL)).toBeVisible();

    // --- original admin deactivates the new teammate ---
    await gotoResilient(page, "/admin/users");
    const rowToDeactivate = page.getByRole("row", { name: new RegExp(newAdminEmail) });
    await rowToDeactivate.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText(`Deactivate ${newAdminEmail}?`)).toBeVisible();
    await page.getByRole("button", { name: "Yes, deactivate" }).click();
    await expect(rowToDeactivate.getByText("Deactivated")).toBeVisible({ timeout: 25000 });
    await expect(rowToDeactivate.getByRole("button", { name: "Reactivate" })).toBeVisible();

    // --- deactivation kicks them out: their EXISTING, still-open session
    // (same browser context, no new login) is rejected on its next request ---
    await gotoResilient(teammatePage, "/admin/users");
    await expect(teammatePage).toHaveURL(/\/login$/, { timeout: 25000 });

    // --- deactivation also locks the account out of ever signing in again:
    // requestMagicLink silently refuses a deactivated email (no token is
    // ever issued, same non-leaking response shape as an unknown email) ---
    const requestLinkRes = await teammatePage.request.post(`${BASE_URL}/api/auth/request-link`, {
      data: { email: newAdminEmail },
    });
    expect(requestLinkRes.ok()).toBe(true); // generic "requested: true" — never reveals account status
    const devLinkRes = await teammatePage.request.get(
      `${BASE_URL}/api/dev/magic-link?email=${encodeURIComponent(newAdminEmail)}`,
    );
    expect(devLinkRes.ok()).toBe(false); // no token was ever issued

    await teammateContext.close();

    // --- DB-level confirmation: deactivated_at set, audited ---
    const row = await db.query(`select deactivated_at from users where email = $1`, [newAdminEmail]);
    expect(row.rows[0].deactivated_at).not.toBeNull();
    const audit = await db.query(
      `select action from audit_log where entity_type = 'user' and action in ('create', 'deactivate') and jurisdiction_id = $1 and entity_id = (select id from users where email = $2) order by at`,
      [jurisdictionId, newAdminEmail],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["create", "deactivate"]);
  });

  test("sign-in-link generation is rate-limited", async ({ page, request }) => {
    await loginViaDevMagicLink(page, request, ADMIN_EMAIL);

    const runId = Date.now();
    const targetEmail = `g3-users-e2e-ratelimit-target-${runId}@example.gov`;
    const createRes = await page.request.post(`${BASE_URL}/api/admin/users`, {
      data: { email: targetEmail, role: "viewer" },
    });
    expect(createRes.ok()).toBe(true);
    const created = (await createRes.json()) as { user: { id: string } };
    const targetId = created.user.id;

    // Production default is 10/15min per acting admin
    // (app/api/admin/users/[userId]/sign-in-link/route.ts) — this harness
    // deliberately does NOT override it, so some call within this loop
    // (the exact index depends on how many links this admin has already
    // generated earlier in this run, e.g. the previous test in this spec)
    // must be rejected for the limiter to be proven wired in for real.
    let sawRateLimited = false;
    for (let i = 0; i < 15; i++) {
      const res = await page.request.post(`${BASE_URL}/api/admin/users/${targetId}/sign-in-link`);
      if (res.status() === 429) {
        sawRateLimited = true;
        expect(res.headers()["retry-after"]).toBeTruthy();
        break;
      }
      expect(res.ok()).toBe(true);
    }
    expect(sawRateLimited).toBe(true);
  });
});
