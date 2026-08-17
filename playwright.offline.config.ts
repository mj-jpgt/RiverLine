import { defineConfig, devices } from "@playwright/test";

// Separate config for `pnpm test:offline` (scripts/test-offline.mjs). It
// deliberately does NOT declare a `webServer` — the script builds and starts
// a *production* Next.js server itself (Serwist only precaches in
// production; next.config.ts disables it entirely in development, ADR
// 0002), on a different port than the dev `pnpm dev` webServer used by
// `pnpm test:e2e`, so the two suites never collide if run back to back.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: /offline-capture\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  // A full 12-element capture flow with real photo processing (createImageBitmap
  // + canvas downscale + SHA-256 per photo) and several deliberate
  // reload-mid-flow steps takes longer than Playwright's 30s default.
  timeout: 120000,
  reporter: "list",
  use: {
    baseURL: process.env.OFFLINE_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
