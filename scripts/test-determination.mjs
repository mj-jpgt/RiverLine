#!/usr/bin/env node
// pnpm test:determination — dedicated e2e gate for T-C5 (M4 determination +
// adoption workflow), mirroring the scripts/test-offline.mjs pattern T-C3
// already established for its own dedicated gate.
//
// Why this exists instead of running under the normal `pnpm test:e2e`
// webServer: the LT-3 chain (assessor capture -> sync -> official review ->
// override -> adopt -> supersede) needs a REAL calculation, which needs a
// real cost_tables row. AGENTS.md rule 6 forbids seeding fixture data into
// riverline_dev — which is what `pnpm dev` (the normal e2e webServer)
// points at, and test/e2e/calculation.spec.ts (T-C4) specifically depends
// on riverline_dev having ZERO cost_tables rows to prove the honest "no
// cost table loaded" state. This script instead points a `pnpm dev`
// instance at riverline_test (seeded with the same TEST-FIXTURE cost table
// test/unit/engine/persist.test.ts already uses), on a dedicated port, so
// neither suite's assumptions collide with the other's.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "./db/ensure-database.mjs";
import { applyMigrations } from "./db/migrate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DETERMINATION_TEST_PORT ?? "3100";
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
const testEnv = { ...loadedEnv, DATABASE_URL: testUrl };

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

console.log("=== pnpm test:determination — real M4 review/override/adopt/supersede chain, riverline_test ===\n");

console.log("--- riverline_test: ensure exists + migrate ---");
await ensureDatabaseExists(testUrl);
await applyMigrations(testUrl);

console.log("--- db seed --test (Demo City + demo users + practice structure) ---");
let status = run("node", ["scripts/db/seed.mjs", "--test"]);
if (status !== 0) {
  console.error("\nBLOCKER: could not seed riverline_test.");
  process.exit(status ?? 1);
}

console.log("--- seed TEST-FIXTURE cost table, scoped to Demo City (riverline_test only, AGENTS.md rule 6) ---");
{
  const costTableFixture = JSON.parse(
    readFileSync(path.resolve(__dirname, "../test/fixtures/engine/cost-table.test-fixture-v0.json"), "utf8"),
  );
  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    const jurisdiction = await client.query("select id from jurisdictions where name = 'Demo City'");
    if (jurisdiction.rows.length === 0) {
      throw new Error("Demo City jurisdiction not found after seeding riverline_test.");
    }
    const jurisdictionId = jurisdiction.rows[0].id;
    await client.query(
      `insert into cost_tables (version, jurisdiction_id, source_citation, effective_date, json_payload)
       values ($1, $2, $3, $4, $5)
       on conflict (version) do nothing`,
      [
        `${costTableFixture.version}-determination-e2e`,
        jurisdictionId,
        costTableFixture.source_citation,
        costTableFixture.effective_date,
        JSON.stringify({ base_cost_per_sqft: costTableFixture.base_cost_per_sqft }),
      ],
    );
    console.log(`  cost table seeded for Demo City (${jurisdictionId}).`);
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

  console.log("\n--- playwright test --config=playwright.determination.config.ts ---");
  const testStatus = run(
    "pnpm",
    ["exec", "playwright", "test", "--config=playwright.determination.config.ts"],
    { env: { ...testEnv, DETERMINATION_BASE_URL: BASE_URL } },
  );
  exitCode = testStatus ?? 1;
} catch (err) {
  console.error("\nBLOCKER:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  server.kill();
}

if (exitCode === 0) {
  console.log("\npnpm test:determination PASSED.");
} else {
  console.error("\npnpm test:determination FAILED. This is a real blocker, not a false pass.");
}
process.exit(exitCode);
