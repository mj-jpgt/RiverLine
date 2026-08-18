import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

// Runs the exact root suite against an alternate port when localhost:3000 is
// unavailable (e.g. occupied by an unrelated process — see
// docs/journal/2026-08-18-v-integration.md). Same specs, same testIgnore,
// same projects; only the address changes. Usage:
//   E2E_PORT=3050 pnpm exec playwright test --config=playwright.alt-port.config.ts --project=chromium
const port = process.env.E2E_PORT ?? "3050";

export default defineConfig({
  ...baseConfig,
  use: { ...baseConfig.use, baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
