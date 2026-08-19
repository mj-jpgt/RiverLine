import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

// G4 intelligence e2e gate (test/run-g4-e2e.mjs, port 4950): proves the two
// user-visible outcomes task instructions call for —
//   1. the review screen flags a damaged element with no photo on file
//   2. the review queue explains its priority ordering in plain language
// Mirrors test/e2e/determination.spec.ts's capture/login helpers (that file
// is not a module other specs import from, so the minimal pieces needed
// here are reproduced rather than shared, matching this codebase's existing
// per-gate spec convention).
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

/** Drives a full 12-element residential capture with a uniform damage % on
 * every element, syncs, and returns the clientId. Deliberately attaches only
 * the required exterior photo (no per-element photos) — every damaged
 * element ends up with zero photos, which is exactly what
 * "missing_photo_for_damaged_element" needs to exercise. */
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
  await page.getByLabel("Notes").fill(`G4 intelligence e2e run — ${uniformDamagePct}% uniform damage.`);
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

test.describe("G4 intelligence — triage explanation and review flags", () => {
  test.describe.configure({ mode: "serial" });

  let admin: pg.Client;
  let clientId: string;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — test/run-g4-e2e.mjs needs riverline_test.");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("assessor captures a borderline assessment with no per-element photos, syncs", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, ASSESSOR_EMAIL);
    // 50% uniform damage on the TEST-FIXTURE cost table -> BORDERLINE, same
    // math test/e2e/determination.spec.ts already relies on.
    clientId = await captureFullAssessment(page, 50);

    await page.goto("/home");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("review queue explains its priority ordering in plain language", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto("/determination");
    await expect(page.getByRole("heading", { name: "Determination queue" })).toBeVisible();

    // Exposure rollup row — additive, task requirement 3.
    await expect(page.getByText("Unreviewed assessments")).toBeVisible();
    await expect(page.getByText("Computed repair cost awaiting review")).toBeVisible();

    // "Why this order?" disclosure — the exact formula, in plain language.
    const disclosure = page.getByText("Why this order?");
    await expect(disclosure).toBeVisible();
    await disclosure.click();
    await expect(page.getByText(/how close the ratio is to the 50% legal line/)).toBeVisible();
    await expect(page.getByText(/improvement value at stake/)).toBeVisible();
    await expect(page.getByText(/flood zone severity/)).toBeVisible();

    // Every queue row shows its numeric priority.
    await expect(page.getByText(/Priority \d+/).first()).toBeVisible();
  });

  test("review screen flags a damaged element with no photo on file", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await page.goto(`/determination/${encodeURIComponent(clientId)}`);

    await expect(page.getByRole("heading", { name: "Flags" })).toBeVisible();
    // Every one of the 12 damaged elements has zero per-element photos
    // (captureFullAssessment only attaches the exterior photo) — Foundations
    // is one of them, and its flag sentence names the recorded percentage.
    await expect(page.getByText(/This element is recorded with 50% damage but has no photo on file\./).first()).toBeVisible();
    await expect(page.getByText(/Confirm the damage percentage against a photo/).first()).toBeVisible();

    // Flags never block adoption — the Adopt action is still present.
    await expect(page.getByRole("button", { name: "Adopt determination" })).toBeVisible();
  });
});
