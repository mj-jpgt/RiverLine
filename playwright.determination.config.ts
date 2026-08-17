import { defineConfig, devices } from "@playwright/test";

// Separate config for `pnpm test:determination` (scripts/test-determination.mjs),
// mirroring the pattern playwright.offline.config.ts already established for
// T-C3's own dedicated gate. Why a separate harness: the T-C5 acceptance
// check (specs/core/tasks.md) needs a REAL calculation to override/adopt/
// supersede, which needs a real cost_tables row — and AGENTS.md rule 6
// ("Mock/fixture data lives only in test/fixtures/ and seeds only databases
// named *_test") forbids seeding one into riverline_dev, which is what the
// normal `pnpm test:e2e` webServer (`pnpm dev`) points at. This config runs
// a `pnpm dev` instance pointed at riverline_test instead (seeded by
// scripts/test-determination.mjs with a TEST-FIXTURE cost table, same
// fixture test/unit/engine/persist.test.ts already uses), on its own port
// so it never collides with the normal e2e webServer.
export default defineConfig({
  testDir: "./test/e2e",
  // a1-letters.spec.ts joined this gate 2026-08-17: it has the same needs
  // (riverline_test + TEST-FIXTURE cost table + dedicated dev server) and
  // cannot run against riverline_dev, whose empty cost_tables state is
  // intentional (specs/constitution.md §2).
  testMatch: /(determination|a1-letters)\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  // Two full 12-element capture flows in the first test (against `next dev`,
  // which compiles each route on first hit) plus several review/override/
  // adopt/supersede round trips in later tests need more headroom than the
  // 30s default.
  timeout: 180000,
  reporter: "list",
  use: {
    baseURL: process.env.DETERMINATION_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
