import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  // offline-capture.spec.ts is T-C3's own gate (`pnpm test:offline`,
  // scripts/test-offline.mjs + playwright.offline.config.ts) — it requires
  // a real PRODUCTION build (Serwist/service-worker precache only exists
  // in production, next.config.ts) and asserts on that. Running it here
  // against the plain `pnpm dev` webServer below would always fail the
  // service-worker-registration assertion for a reason that has nothing to
  // do with a regression — dev mode deliberately disables Serwist.
  // determination.spec.ts (T-C5) is its own gate (`pnpm test:determination`,
  // scripts/test-determination.mjs + playwright.determination.config.ts) —
  // it needs a real cost_tables row to exercise override/adopt/supersede,
  // and AGENTS.md rule 6 forbids seeding that into riverline_dev, which is
  // what the webServer below points at. Running it here would always fail
  // at "no cost table loaded" for a reason that has nothing to do with a
  // regression — see playwright.determination.config.ts's file header.
  testIgnore: ["**/offline-capture.spec.ts", "**/determination.spec.ts", "**/a1-letters.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // iOS Safari is the real deployment target (docs/adr/0002-offline-and-pwa.md).
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
