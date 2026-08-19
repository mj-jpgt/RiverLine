#!/usr/bin/env node
// pnpm test:users — dedicated e2e gate for T-G3 (team user management:
// admin creates a user, generates an on-demand sign-in link, a NEW browser
// context uses it, and deactivation locks the account out), mirroring the
// scripts/test-admin.mjs / scripts/test-determination.mjs pattern.
//
// Own port (4900), own dev server, own fresh jurisdiction: this spec needs
// a jurisdiction with a real, tiny team roster it fully controls (starts
// with exactly one admin and nobody else, so "Add a team member" and the
// resulting roster changes are unambiguous) — sharing riverline_test's
// jurisdiction with other gates (determination.spec.ts, admin.spec.ts)
// would make "how many users are in this jurisdiction" a moving target
// across concurrent test runs. AGENTS.md rule 6: only ever seeds
// riverline_test.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "./db/ensure-database.mjs";
import { applyMigrations } from "./db/migrate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.USERS_TEST_PORT ?? "4900";
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
const jurisdictionName = `G3 Users E2E City ${runId}`;
const adminEmail = `g3-users-e2e-admin-${runId}@example.gov`;

// AUTH_RATE_LIMIT_*: this spec logs in via dev magic link several times per
// run; production defaults (5/15min) correctly block that (same override
// scripts/test-admin.mjs documents). SIGN_IN_LINK_RATE_LIMIT_ACTOR is
// deliberately left at its production default (10/15min) — the rate-limit
// test in this spec needs the REAL limit to actually fire.
const testEnv = {
  ...loadedEnv,
  DATABASE_URL: testUrl,
  AUTH_RATE_LIMIT_EMAIL: "1000",
  AUTH_RATE_LIMIT_IP: "1000",
  USERS_JURISDICTION_NAME: jurisdictionName,
  USERS_EMAIL_ADMIN: adminEmail,
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

console.log("=== pnpm test:users — T-G3 team user management real e2e, riverline_test ===\n");

console.log("--- riverline_test: ensure exists + migrate ---");
await ensureDatabaseExists(testUrl);
await applyMigrations(testUrl);

console.log(`--- seeding fresh jurisdiction "${jurisdictionName}" + 1 admin ---`);
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

    await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin')`, [
      adminEmail,
      jurisdictionId,
    ]);

    console.log(`  jurisdiction ${jurisdictionId}, admin ${adminEmail} seeded.`);
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

  console.log("\n--- playwright test --config=playwright.users.config.ts ---");
  const testStatus = run("pnpm", ["exec", "playwright", "test", "--config=playwright.users.config.ts"], {
    env: { ...testEnv, USERS_BASE_URL: BASE_URL },
  });
  exitCode = testStatus ?? 1;
} catch (err) {
  console.error("\nBLOCKER:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  server.kill();
}

if (exitCode === 0) {
  console.log("\npnpm test:users PASSED.");
} else {
  console.error("\npnpm test:users FAILED. This is a real blocker, not a false pass.");
}
process.exit(exitCode);
