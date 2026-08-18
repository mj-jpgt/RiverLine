import { defineConfig, devices } from "@playwright/test";

// Separate config for `pnpm test:admin` (scripts/test-admin.mjs), mirroring
// the pattern playwright.offline.config.ts / playwright.determination.config.ts
// already established for their own dedicated gates. Why a separate
// harness: T-W5's e2e proves the "no cost table loaded" -> "loaded via the
// admin UI" -> "calculation now computes" flip, which needs the SAME
// jurisdiction to start with genuinely zero cost_tables rows and then have
// exactly one loaded through the real form — AGENTS.md rule 6 forbids
// seeding that into riverline_dev (the normal `pnpm test:e2e` webServer),
// and running it against the shared riverline_test jurisdiction other
// gates' cost tables already populate (determination/a1-letters) would
// never observe the honest "NOT SET" starting state. This config runs a
// `pnpm dev` instance pointed at riverline_test on its own port (3900),
// seeded by scripts/test-admin.mjs with a FRESH, uniquely-named
// jurisdiction every run.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: /admin\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180000,
  // Generous default assertion timeout: this repo's shared-working-tree
  // convention (docs/agents/SUBAGENT.md) means this gate can run alongside
  // other agents' concurrent `next dev` / build activity on the same
  // machine, which measurably slows first-compile responses under load.
  // The 5s Playwright default is too tight for that contention; retries:0
  // above means a flake here is a real failure, so generosity here is
  // buying headroom against load, not masking a bug.
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    baseURL: process.env.ADMIN_BASE_URL ?? "http://localhost:3900",
    trace: "retain-on-failure",
    actionTimeout: 20000,
    navigationTimeout: 30000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
