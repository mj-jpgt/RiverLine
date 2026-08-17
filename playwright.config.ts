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
  testIgnore: "**/offline-capture.spec.ts",
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
