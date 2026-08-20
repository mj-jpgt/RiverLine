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
  // reload-mid-flow steps takes longer than Playwright's 30s default. F2
  // (2026-08-19) added a second kill-mid-flow probe (a kill-mid-photo-upload
  // resume, on top of the pre-existing kill-mid-element-entry one) with its
  // own retry-loop waits, so this went from 120s to 180s.
  timeout: 180000,
  reporter: "list",
  use: {
    baseURL: process.env.OFFLINE_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // F2 (2026-08-19): this environment's own memory pressure (many
        // concurrent dev tools/agents on the host machine, not this repo's
        // code) was observed reloading/discarding this test's tab
        // mid-run — Chromium's standard background-tab power-saving
        // behavior, normally harmless for a real foreground user but fatal
        // to a long automated run whose window isn't guaranteed focus.
        // These are the standard flags for disabling exactly that class of
        // throttling/discarding; real device behavior is unaffected (they
        // only change automation-host scheduling, not app code).
        launchOptions: {
          args: [
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-ipc-flooding-protection",
          ],
        },
      },
    },
  ],
});
