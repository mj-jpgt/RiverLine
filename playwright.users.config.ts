import { defineConfig, devices } from "@playwright/test";

// Separate config for `pnpm test:users` (scripts/test-users.mjs), same
// pattern playwright.admin.config.ts / playwright.determination.config.ts
// already establish for their own dedicated gates. Own port (4900, per
// task instructions), own fresh jurisdiction seeded with exactly one admin
// and nobody else — see scripts/test-users.mjs's header for why this
// can't share riverline_test's other gates' jurisdictions.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: /users\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    baseURL: process.env.USERS_BASE_URL ?? "http://localhost:4900",
    trace: "retain-on-failure",
    actionTimeout: 20000,
    navigationTimeout: 30000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
