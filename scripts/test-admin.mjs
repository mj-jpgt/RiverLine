#!/usr/bin/env node
// pnpm test:admin — dedicated e2e gate for T-W5 (admin console: cost
// tables, jurisdiction settings, readiness), mirroring the
// scripts/test-determination.mjs / scripts/test-offline.mjs pattern.
//
// Why this exists instead of running under the normal `pnpm test:e2e`
// webServer: the headline proof is "no cost table loaded" -> admin loads
// one through the real form -> "calculation now computes." That needs a
// jurisdiction that starts with genuinely ZERO cost_tables rows (so the
// blocked state is real, not stale) and then has exactly one row inserted
// through the UI under test — riverline_dev is off-limits for seeding
// (AGENTS.md rule 6), and the shared riverline_test jurisdiction other
// gates use (determination.spec.ts, a1-letters.spec.ts) already has cost
// tables loaded by the time this could run after them. This script creates
// a FRESH, uniquely-named jurisdiction + admin/assessor/official users +
// one practice structure every run, on its own port (3900), and passes
// their identities to the spec via env vars (same pattern
// DETERMINATION_BASE_URL already uses).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "./db/ensure-database.mjs";
import { applyMigrations } from "./db/migrate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.ADMIN_TEST_PORT ?? "3900";
const BASE_URL = `http://localhost:${PORT}`;
const isWin = process.platform === "win32";

const envLocalPath = path.resolve(__dirname, "../.env.local");
const loadedEnv = { ...process.env };
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (loadedEnv[key] === undefined) loadedEnv[key] = value;
  }
}

const baseUrl = loadedEnv.DATABASE_URL;
if (!baseUrl) {
  console.error("BLOCKER: DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");

const runId = Date.now();
const jurisdictionName = `W5 Admin E2E City ${runId}`;
const adminEmail = `w5-admin-e2e-admin-${runId}@example.gov`;
const assessorEmail = `w5-admin-e2e-assessor-${runId}@example.gov`;
const officialEmail = `w5-admin-e2e-official-${runId}@example.gov`;
const practiceAddress = `${runId} W5 Admin Test Ln`;

// AUTH_RATE_LIMIT_*: this spec logs in several times per seeded email in
// one run; production limits (5/15min) correctly block that. Relaxed here
// for this harness only (see app/api/auth/request-link/route.ts), same
// override scripts/test-determination.mjs already documents.
const testEnv = {
  ...loadedEnv,
  DATABASE_URL: testUrl,
  AUTH_RATE_LIMIT_EMAIL: "1000",
  AUTH_RATE_LIMIT_IP: "1000",
  ADMIN_JURISDICTION_NAME: jurisdictionName,
  ADMIN_EMAIL_ADMIN: adminEmail,
  ADMIN_EMAIL_ASSESSOR: assessorEmail,
  ADMIN_EMAIL_OFFICIAL: officialEmail,
  ADMIN_PRACTICE_ADDRESS: practiceAddress,
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: isWin, env: testEnv, ...opts });
  return res.status;
}

function waitForServer(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Dev server did not respond at ${url} within ${timeoutMs}ms.`));
          return;
        }
        setTimeout(poll, 500);
      });
    })();
  });
}

console.log("=== pnpm test:admin — T-W5 admin console real e2e, riverline_test ===\n");

console.log("--- riverline_test: ensure exists + migrate ---");
await ensureDatabaseExists(testUrl);
await applyMigrations(testUrl);

console.log(`--- seeding fresh jurisdiction "${jurisdictionName}" (zero cost_tables rows) + 3 users + 1 practice structure ---`);
{
  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    const j = await client.query(
      `insert into jurisdictions (name, nfip_cid, ordinance_citation, letterhead_config)
       values ($1, null, null, '{}'::jsonb) returning id`,
      [jurisdictionName],
    );
    const jurisdictionId = j.rows[0].id;

    for (const [email, role] of [
      [adminEmail, "admin"],
      [assessorEmail, "assessor"],
      [officialEmail, "official"],
    ]) {
      await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, $3)`, [
        email,
        jurisdictionId,
        role,
      ]);
    }

    await client.query(
      `insert into structures (
         jurisdiction_id, parcel_id, address, assessor_market_value,
         improvement_value, value_source, value_as_of_date, occupancy_type,
         foundation_type, stories, sq_ft, year_built, prop_class
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        jurisdictionId,
        `W5-ADMIN-E2E-${runId}`,
        practiceAddress,
        180000.0,
        140000.0,
        "official_override",
        "2026-01-01",
        "residential",
        "slab",
        1,
        1600,
        1998,
        "PRACTICE",
      ],
    );

    console.log(`  jurisdiction ${jurisdictionId}, structure "${practiceAddress}" seeded.`);
  } finally {
    await client.end();
  }
}

console.log(`\n--- pnpm dev -p ${PORT} (against riverline_test) ---`);
const server = spawn("pnpm", ["exec", "next", "dev", "-p", PORT], {
  stdio: "inherit",
  shell: isWin,
  env: testEnv,
});
server.on("error", (err) => {
  console.error("BLOCKER: could not start the dev server:", err);
  process.exit(1);
});

let exitCode = 1;
try {
  await waitForServer(BASE_URL);
  console.log(`\n--- dev server ready at ${BASE_URL} ---`);

  console.log("\n--- playwright test --config=playwright.admin.config.ts ---");
  const testStatus = run("pnpm", ["exec", "playwright", "test", "--config=playwright.admin.config.ts"], {
    env: { ...testEnv, ADMIN_BASE_URL: BASE_URL },
  });
  exitCode = testStatus ?? 1;
} catch (err) {
  console.error("\nBLOCKER:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  server.kill();
}

if (exitCode === 0) {
  console.log("\npnpm test:admin PASSED.");
} else {
  console.error("\npnpm test:admin FAILED. This is a real blocker, not a false pass.");
}
process.exit(exitCode);
