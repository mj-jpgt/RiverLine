import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// M3/T-C4: walks a real assessor through a real synced assessment to the
// calculation screen, against the dev database (`pnpm dev`, riverline_dev)
// which — per specs/constitution.md §2 and docs/BLOCKERS.md B1 —
// legitimately has NO cost table seeded (scripts/db/seed.mjs never touches
// cost_tables; only test/unit/engine/persist.test.ts seeds one, and only
// into riverline_test, per AGENTS.md rule 6). This spec proves that the
// honest "No cost table loaded" state renders in dev, not a fabricated
// dollar figure — the exact scenario T-C4's brief asks for.
//
// A different demo user than login.spec.ts (assessor@example.gov) and
// registry.spec.ts (official@example.gov) — same reasoning both of those
// files already document: the dev-only magic-link store
// (src/core/auth/dev-link-store.ts) holds one pending link per email, and
// all three specs share the same `pnpm dev` webServer under `pnpm test:e2e`.
const DEMO_EMAIL = "admin@example.gov";
const PRACTICE_ADDRESS = "123 Practice Ln";
const RESIDENTIAL_ELEMENT_COUNT = 12;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTERIOR_FIXTURE = path.resolve(__dirname, "../fixtures/photos/sample-exterior.jpg");

async function loginViaDevMagicLink(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  baseURL: string | undefined,
) {
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

test.describe("M3 calculation view", () => {
  // Serial for the same dev-magic-link-store-per-email reason
  // registry.spec.ts documents.
  test.describe.configure({ mode: "serial" });

  test("a real synced assessment routes to the calculation screen and shows the honest 'no cost table loaded' state in dev", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL);

    // ---- Registry: open the seeded practice structure ------------------
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

    // ---- Attributes: occupancy prefilled residential from the seed row --
    await expect(page.getByRole("button", { name: "Residential", exact: true })).toHaveAttribute(
      "class",
      /optionButtonSelected/,
    );
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // ---- All 12 residential elements ------------------------------------
    for (let i = 0; i < RESIDENTIAL_ELEMENT_COUNT; i++) {
      await expect(page.getByText(`Element ${i + 1} of ${RESIDENTIAL_ELEMENT_COUNT}`)).toBeVisible();
      await page.getByRole("button", { name: "25%" }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }

    // ---- Required exterior photo ------------------------------------------
    await expect(page.getByRole("heading", { name: "Exterior photo" })).toBeVisible();
    await page.getByLabel("Take exterior photo").setInputFiles(EXTERIOR_FIXTURE);
    await expect(page.locator("img[alt='Captured damage photo']")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // ---- Water depth (optional — leave both fields empty) -----------------
    await expect(page.getByText("Interior water depth")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // ---- Notes --------------------------------------------------------------
    await expect(page.getByText("Assessment notes")).toBeVisible();
    await page.getByLabel("Notes").fill("Calculation e2e test run.");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // ---- Review + complete ---------------------------------------------------
    await expect(page.getByText("Review and complete")).toBeVisible();
    const completeButton = page.getByRole("button", { name: "Complete assessment" });
    await expect(completeButton).toBeEnabled();
    await completeButton.click();

    await expect(page.getByRole("heading", { name: "Assessment complete" })).toBeVisible({ timeout: 10000 });

    // Real network is available in this spec (unlike offline-capture.spec.ts) —
    // wait for the real sync to land before the calculation trigger appears.
    const viewCalculation = page.getByRole("button", { name: "View calculation" });
    await expect(viewCalculation).toBeVisible({ timeout: 20000 });
    await viewCalculation.click();

    await expect(page).toHaveURL(/\/calculation\/[^/]+$/);

    // The honest, explicit blocked state (specs/constitution.md §2 /
    // docs/BLOCKERS.md B1) — never a fabricated dollar figure. riverline_dev
    // genuinely has zero cost_tables rows (scripts/db/seed.mjs never seeds
    // one; only riverline_test gets the TEST-FIXTURE table, and only via
    // test/unit/engine/persist.test.ts's own setup).
    await expect(page.getByRole("heading", { name: "No cost table loaded" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/docs\/BLOCKERS\.md B1/)).toBeVisible();
    await expect(page.getByText(/nothing is lost/i)).toBeVisible();

    // No fabricated ratio/threshold rendered anywhere on this blocked state.
    await expect(page.getByText(/not substantial damage/i)).toHaveCount(0);
    await expect(page.getByText(/substantial damage$/i)).toHaveCount(0);

    const backLink = page.getByRole("link", { name: "← Back to structure" });
    await expect(backLink).toBeVisible();
  });

  test("unauthenticated visit to a calculation URL redirects to /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/calculation/does-not-matter");
    await expect(page).toHaveURL(/\/login$/);
  });
});
