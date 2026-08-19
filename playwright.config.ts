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
  // admin.spec.ts (T-W5) joined this exclusion list for the same reason as
  // determination.spec.ts / a1-letters.spec.ts: it needs its own fresh
  // jurisdiction (zero cost_tables rows to start) and its own dedicated
  // dev server (`pnpm test:admin`, scripts/test-admin.mjs + PORT 3900),
  // never riverline_dev.
  // g4-intelligence.spec.ts (G4) is its own gate too, same reason: it needs
  // a real cost_tables row on riverline_test to exercise the review queue
  // and review screen (`node test/run-g4-e2e.mjs`, test/playwright.g4.config.ts,
  // port 4950). Running it here against riverline_dev would always fail at
  // "no cost table loaded," not a regression.
  // users.spec.ts (T-G3) joined this list for the same reason: it throws at
  // module load (not inside a test) when its own required env vars
  // (USERS_EMAIL_ADMIN etc.) are unset, which aborts the ENTIRE root suite
  // before any test runs — verified directly (G2, 2026-08-18): running the
  // full root suite without this exclusion failed immediately with "Error:
  // USERS_EMAIL_ADMIN is not set — this spec must run via `pnpm test:users`"
  // and zero tests executed. It needs its own fresh jurisdiction and
  // dedicated runner (`pnpm test:users`, scripts/test-users.mjs,
  // playwright.users.config.ts), same shape as admin.spec.ts/g4-intelligence.spec.ts.
  testIgnore: [
    "**/offline-capture.spec.ts",
    "**/determination.spec.ts",
    "**/a1-letters.spec.ts",
    "**/admin.spec.ts",
    "**/g4-intelligence.spec.ts",
    "**/users.spec.ts",
  ],
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
