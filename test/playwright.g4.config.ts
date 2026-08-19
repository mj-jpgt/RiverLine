import { defineConfig, devices } from "@playwright/test";

// Separate config for `node test/run-g4-e2e.mjs` (G4 intelligence gate),
// mirroring the pattern playwright.determination.config.ts already
// established: a real cost_tables row is needed to exercise the review
// queue/screen, which AGENTS.md rule 6 forbids seeding into riverline_dev.
// Runs on its own port (4950) and its own testMatch so it never collides
// with the determination gate (port 3100) or the root e2e suite (port
// 3000) if they happen to run at the same time.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /g4-intelligence\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180000,
  reporter: "list",
  use: {
    baseURL: process.env.G4_BASE_URL ?? "http://localhost:4950",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
