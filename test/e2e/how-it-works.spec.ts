import { expect, test } from "@playwright/test";

// T-G2: the "how it works" pitch/story page and its print-first paper
// fallback. Both are PUBLIC routes (no requireRole guard, same posture as
// app/page.tsx and app/login) — runs in the ROOT suite (playwright.config.ts,
// `pnpm dev` against riverline_dev), no special fixture/cost-table
// dependency, same reasoning shell.spec.ts already documents for itself.

test.describe("T-G2 how-it-works", () => {
  test("tells the five-station system story and links to the training demo and paper fallback", async ({
    page,
  }) => {
    await page.goto("/how-it-works");

    await expect(page.getByRole("heading", { name: "One record, five stations, one team" })).toBeVisible();

    // All five stations, in order, each with its three-part breakdown.
    const stationTitles = [
      "Capture, in the field, offline",
      "Automatic math, against a dated cost table",
      "Official review, with audited overrides",
      "The determination letter",
      "Exports, three shapes of the same record",
    ];
    for (const title of stationTitles) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(page.getByText("Who does it").first()).toBeVisible();
    await expect(page.getByText("What the app automates").first()).toBeVisible();
    await expect(page.getByText("What stays human").first()).toBeVisible();

    // Value story, stated honestly (not marketing superlatives).
    await expect(page.getByRole("heading", { name: "Fewer re-visits" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Determinations that survive appeal" })).toBeVisible();

    // "How reports move today" says B4 (email delivery) plainly, not vaguely.
    await expect(page.getByText(/connects an email service.*that connection is not live yet/i)).toBeVisible();

    // Run-the-demo block: the exact three training accounts, real jurisdiction
    // name, and a working link into /login.
    await expect(page.getByText("Riverline Training Demo")).toBeVisible();
    await expect(page.getByText("demo-assessor@riverline-training.example")).toBeVisible();
    await expect(page.getByText("demo-official@riverline-training.example")).toBeVisible();
    await expect(page.getByText("demo-admin@riverline-training.example")).toBeVisible();

    const demoCta = page.getByRole("link", { name: "Sign in to try it" });
    await expect(demoCta).toBeVisible();
    const ctaBox = await demoCta.boundingBox();
    expect(ctaBox?.height).toBeGreaterThanOrEqual(48);
    await demoCta.click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/how-it-works");
    const paperLink = page.getByRole("link", { name: "Print the field worksheet" });
    await expect(paperLink).toBeVisible();
    await paperLink.click();
    await expect(page).toHaveURL(/\/how-it-works\/paper-form$/);
  });

  // The paper worksheet itself (element table row counts, structure header
  // fields, damage-percentage presets) is covered in its own file,
  // test/e2e/paper-form.spec.ts, rather than duplicated here.

  test("no em dash and no emoji anywhere on the page's rendered text", async ({ page }) => {
    await page.goto("/how-it-works");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("—"); // em dash
    expect(bodyText).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
