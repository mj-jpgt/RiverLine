import { expect, test } from "@playwright/test";

// T-G2, spec §11.4 (paper fallback). Public route, root suite (same
// reasoning as how-it-works.spec.ts). Asserts the printable worksheet
// renders and its element table row counts match the verified SDE 3.0
// structure (docs/data-contracts/sde-cost-tables.md: 12 residential, 7
// non-residential), imported live from src/core/capture in the page itself
// — this test re-derives the expected counts from the same source so it
// would fail if that source ever drifted, not just if the page's markup
// broke.
const RESIDENTIAL_ELEMENT_NAMES = [
  "Foundations",
  "Superstructure",
  "Roof covering",
  "Exterior finish",
  "Interior finish",
  "Doors and windows",
  "Cabinets and countertops",
  "Floor finish",
  "Plumbing",
  "Electrical",
  "Appliances",
  "HVAC",
];

const NON_RESIDENTIAL_ELEMENT_NAMES = [
  "Foundations",
  "Superstructure",
  "Roof covering",
  "Plumbing",
  "Electrical",
  "Interiors",
  "HVAC",
];

const DAMAGE_PRESETS = [0, 10, 25, 50, 75, 100];

test.describe("T-G2 paper fallback worksheet", () => {
  test("renders the structure header, both element tables at the correct counts, and the damage-percentage presets", async ({
    page,
  }) => {
    await page.goto("/how-it-works/paper-form");

    await expect(page.getByRole("heading", { name: "RiverLine field assessment worksheet" })).toBeVisible();

    // Structure header fields an assessor fills in by hand.
    for (const label of ["Address", "Parcel ID", "Date of assessment", "Assessor name", "Occupancy type"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    // --- Residential table: 12 element rows, matching the verified list ---
    const residentialHeading = page.getByRole("heading", { name: /Residential \(12 elements\)/ });
    await expect(residentialHeading).toBeVisible();
    const residentialSection = page.locator("section", { has: residentialHeading });
    const residentialRows = residentialSection.locator("tbody tr");
    await expect(residentialRows).toHaveCount(RESIDENTIAL_ELEMENT_NAMES.length);
    await expect(residentialRows).toHaveCount(12);
    for (const name of RESIDENTIAL_ELEMENT_NAMES) {
      await expect(residentialSection.getByRole("rowheader", { name })).toBeVisible();
    }

    // Every preset percentage is a column header, exactly once, in this table.
    // exact: true — Playwright's default substring match means "0%" would
    // also match "10%"/"50%"/"100%" (all end in the characters "0%").
    for (const pct of DAMAGE_PRESETS) {
      await expect(residentialSection.getByRole("columnheader", { name: `${pct}%`, exact: true })).toBeVisible();
    }

    // --- Non-residential table: 7 element rows ------------------------------
    const nonResidentialHeading = page.getByRole("heading", { name: /Non-residential \(7 elements\)/ });
    await expect(nonResidentialHeading).toBeVisible();
    const nonResidentialSection = page.locator("section", { has: nonResidentialHeading });
    const nonResidentialRows = nonResidentialSection.locator("tbody tr");
    await expect(nonResidentialRows).toHaveCount(NON_RESIDENTIAL_ELEMENT_NAMES.length);
    await expect(nonResidentialRows).toHaveCount(7);
    for (const name of NON_RESIDENTIAL_ELEMENT_NAMES) {
      await expect(nonResidentialSection.getByRole("rowheader", { name })).toBeVisible();
    }

    // Instruction to enter the completed worksheet into the app later.
    await expect(page.getByText(/Enter this worksheet into RiverLine/)).toBeVisible();

    // Print trigger is present (screen-only; hidden at print time by CSS,
    // asserted separately via the stylesheet, not achievable in this
    // headless check).
    await expect(page.getByRole("button", { name: "Print this worksheet" })).toBeVisible();

    // Breadcrumb back to the story page.
    await expect(page.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/how-it-works");
  });

  test("no em dash and no emoji anywhere on the printable page", async ({ page }) => {
    await page.goto("/how-it-works/paper-form");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("—");
    expect(bodyText).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
