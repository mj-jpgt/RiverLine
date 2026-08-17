import { expect, test } from "@playwright/test";

// Toolchain smoke test: proves Playwright is wired to a real running Next.js
// server, not asserting any product behavior (there is none yet).
test("app shell responds and renders the placeholder heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "RiverLine SDD" })).toBeVisible();
});
