import { defineConfig, devices } from "@playwright/test";

// Dedicated Playwright config for `test/e2e/a4-estimates.spec.ts` (T-W2,
// A4). Lives under test/unit/modules/a4/ (not the repo root), mirroring
// test/unit/modules/a2/playwright.a2-dashboard.config.ts's exact reasoning:
// this task's coexistence rules restrict this agent to writing only inside
// src/modules/a4-estimates/, app/estimates/ (+ app/api/estimates/),
// test/unit/modules/a4/, and the single file
// test/e2e/a4-estimates.spec.ts (plus a few other named files) — the root
// playwright.config.ts is off limits (three other agents run concurrently
// in this same working tree), and its own webServer is hardcoded to port
// 3000. This config declares no webServer at all: the acceptance run
// starts `next dev -p 3600` itself (per this task's own PORT 3600
// instruction), detached, and kills it after.
//
// Unlike T-C5/A1's own dedicated configs, this one does NOT need
// riverline_test or a seeded cost table — A4 has no dependency on
// calculations/cost_tables at all, so it runs against the same
// riverline_dev the shared `pnpm test:e2e` webServer already uses. Every
// row this spec touches lives under its own randomly-suffixed jurisdiction
// (seeded directly via SQL in the spec's own beforeAll, same pattern
// test/e2e/a2-dashboard.spec.ts already established), so it composes
// safely with both the dedicated run here AND a shared `pnpm test:e2e` run
// that happens to pick this spec file up too (no testIgnore edit needed on
// the shared config for that reason).
export default defineConfig({
  testDir: "../../../e2e",
  testMatch: /a4-estimates\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  // Real client-side OCR (tesseract.js, WASM + Web Worker) against a real
  // fixture image takes real time — first-load core/lang fetch plus
  // recognition, well above the 30s Playwright default.
  timeout: 120000,
  reporter: "list",
  use: {
    baseURL: process.env.A4_ESTIMATES_BASE_URL ?? "http://localhost:3600",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
