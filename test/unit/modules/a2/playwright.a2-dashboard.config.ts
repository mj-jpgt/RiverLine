import { defineConfig, devices } from "@playwright/test";

// Dedicated Playwright config for `test/e2e/a2-dashboard.spec.ts` (T-A2).
// Lives under test/unit/modules/a2/ (not the repo root) because this task's
// coexistence rules restrict this agent to writing only inside
// src/modules/a2-dashboard/, app/dashboard/, test/unit/modules/a2/, and the
// single file test/e2e/a2-dashboard.spec.ts — the root playwright.config.ts
// is off limits (two other agents run concurrently in this same working
// tree), and its own webServer is hardcoded to port 3000, which this task
// is explicitly told never to touch. This config declares no webServer at
// all: the acceptance run starts `next dev -p 3200` itself, detached, and
// kills it after — same shape as playwright.offline.config.ts's own
// documented reason for omitting webServer.
export default defineConfig({
  testDir: "../../../e2e",
  testMatch: /a2-dashboard\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60000,
  reporter: "list",
  use: {
    baseURL: process.env.A2_DASHBOARD_BASE_URL ?? "http://localhost:3200",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
