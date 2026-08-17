import { expect, test } from "@playwright/test";

// M1 structure registry, against REAL ingested Hamilton County parcel rows
// (scripts/preprocess/ingest-parcels.mjs — `pnpm ingest:parcels` must have
// been run against the dev db before this spec runs; no mock/fixture
// parcels are used anywhere, per AGENTS.md rule 6). "1355 S 10th St" is a
// real LOCADDRESS pulled from the live Hamilton County FeatureServer within
// this task's ingest envelope (see the ingest script header) — verified
// present via a direct DB query against riverline_dev during this task's
// build, not invented.
// A different demo user than test/e2e/login.spec.ts's assessor@example.gov
// on purpose: the dev-only magic-link store (src/core/auth/dev-link-store.ts)
// is keyed by email and holds one pending link per email — two spec files
// requesting a link for the *same* email in true cross-file parallel would
// race. official@example.gov is not used by any other spec.
const DEMO_EMAIL = "official@example.gov";
const REAL_ADDRESS = "1355 S 10th St";

async function loginViaDevMagicLink(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, baseURL: string | undefined) {
  await page.goto("/login");
  const emailInput = page.getByLabel("Email address");
  await emailInput.pressSequentially(DEMO_EMAIL);
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(/sign-in link was sent/i);

  const linkResponse = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(DEMO_EMAIL)}`);
  expect(linkResponse.ok()).toBe(true);
  const { url } = (await linkResponse.json()) as { url: string };
  await page.goto(new URL(url, baseURL).toString());
  await expect(page).toHaveURL(/\/home$/);
}

test.describe("M1 structure registry", () => {
  // Serial: the dev-only magic-link store (src/core/auth/dev-link-store.ts)
  // is keyed by email on globalThis and holds one pending link per email at
  // a time. Two tests requesting a link for the same demo email in true
  // parallel would race (the second POST's link can overwrite the first's
  // before it's consumed) — serial avoids that without needing a distinct
  // demo user per test.
  test.describe.configure({ mode: "serial" });

  test("searches a real ingested address and opens its detail page", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL);

    await page.goto("/registry");
    await expect(page.getByRole("heading", { name: "Find a structure" })).toBeVisible();

    const searchInput = page.getByLabel("Address");

    // Empty/short query: idle state, not an error.
    await expect(page.getByText(/start typing an address/i)).toBeVisible();

    await searchInput.pressSequentially(REAL_ADDRESS);

    // Real result renders: the exact address string from the live parcel
    // ingest, not a placeholder.
    const resultLink = page.getByRole("link", { name: new RegExp(REAL_ADDRESS) });
    await expect(resultLink).toBeVisible({ timeout: 10000 });

    await resultLink.click();

    await expect(page).toHaveURL(/\/registry\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: REAL_ADDRESS })).toBeVisible();

    // Real parcel data rendered on the detail page — parcel id (from
    // PARCELNO), assessed value labeled honestly per value_source, flood
    // zone, and a working "Start assessment" link. Not hardcoded text.
    await expect(page.getByText(/^Parcel \d+$/)).toBeVisible();
    await expect(page.getByText(/assessed improvement value/i)).toBeVisible();
    await expect(page.getByText("Flood hazard")).toBeVisible();

    const startAssessment = page.getByRole("link", { name: "Start assessment" });
    await expect(startAssessment).toBeVisible();
    await startAssessment.click();
    await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/);
    // T-C3 replaced the T-C2 placeholder with the real capture flow — the
    // first screen is "Confirm structure" (attributes), not stub copy.
    await expect(page.getByText("Confirm structure")).toBeVisible();
  });

  test("no-match search shows a designed empty state, not a blank area", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL);
    await page.goto("/registry");

    const searchInput = page.getByLabel("Address");
    await searchInput.pressSequentially("zzz-no-such-address-zzz");

    await expect(page.getByText(/no structures match that address/i)).toBeVisible({ timeout: 10000 });
  });

  test("unauthenticated visit to /registry redirects to /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/registry");
    await expect(page).toHaveURL(/\/login$/);
  });
});
