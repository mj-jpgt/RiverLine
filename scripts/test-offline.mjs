#!/usr/bin/env node
// pnpm test:offline — merge blocker per AGENTS.md: "the field capture flow
// (src/core/capture/) must work with the network fully disabled and sync
// later."
//
// This runs against a real PRODUCTION build, not `pnpm dev` — Serwist only
// precaches the app shell in production (next.config.ts:
// `disable: process.env.NODE_ENV === "development"`, per
// docs/adr/0002-offline-and-pwa.md), and "does /capture/* actually load
// offline after first visit" is one of this gate's own requirements, so a
// dev-mode run would not prove anything real about that. Runs on a
// dedicated port (3100 by default) so it never collides with the normal
// `pnpm dev` webServer `pnpm test:e2e` uses.
//
// test/e2e/offline-capture.spec.ts (driven via playwright.offline.config.ts)
// is the real test: logs in, opens a real structure, goes fully offline
// (context.setOffline(true)), completes an entire 12-element residential
// assessment with real photos, kills/reloads mid-flow to prove
// resume-from-draft, reaches completion offline, asserts the offline
// banner, then re-enables the network, syncs, and asserts via direct
// Postgres queries that the assessment/elements/photos landed — including
// an idempotency probe that resending the same payload does not duplicate.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.OFFLINE_TEST_PORT ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;
const isWin = process.platform === "win32";

// Next.js auto-loads .env.local for `next build`/`next start`, but the
// plain `node scripts/db/seed.mjs` child process below is not Next — it
// reads process.env.DATABASE_URL directly (same convention every other
// scripts/db/*.mjs and scripts/preprocess/*.mjs script in this repo uses).
// Load it once here and forward it to every child process this script
// spawns, so `pnpm test:offline` works standalone without requiring the
// caller to have already exported DATABASE_URL/SESSION_SECRET by hand.
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

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: isWin, env: loadedEnv, ...opts });
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
          reject(new Error(`Production server did not respond at ${url} within ${timeoutMs}ms.`));
          return;
        }
        setTimeout(poll, 500);
      });
    })();
  });
}

console.log("=== pnpm test:offline — real capture flow, real network cut, real production build ===\n");

console.log("--- db seed (ensures Demo City + demo users + the practice structure exist) ---");
let status = run("node", ["scripts/db/seed.mjs"]);
if (status !== 0) {
  console.error(
    "\nBLOCKER: pnpm test:offline could not seed the database. See .env.example / docs/adr/0004-migrations-and-local-db.md.",
  );
  process.exit(status ?? 1);
}

// A from-scratch .next/ before every build: this repo lives inside a
// OneDrive-synced folder, which intermittently corrupts Next's build
// manifest symlinks between runs (`EINVAL: invalid argument, readlink`) —
// the same class of environment issue T-C2's journal documented for
// `next dev`. Not a code bug; a clean directory avoids it deterministically.
// OneDrive's own sync agent can also transiently hold a file lock
// (`EBUSY: resource busy or locked`) on a `.next/` file for a moment right
// after a previous `next start`/`next build` process exits — retry instead
// of letting one transient lock crash the whole gate.
console.log("\n--- clean .next/ (OneDrive + Next build-manifest symlink workaround) ---");
const nextDirUrl = new URL("../.next", import.meta.url);
const NEXT_CLEAN_ATTEMPTS = 15;
for (let attempt = 1; attempt <= NEXT_CLEAN_ATTEMPTS; attempt++) {
  try {
    rmSync(nextDirUrl, { recursive: true, force: true });
    break;
  } catch (err) {
    if (attempt === NEXT_CLEAN_ATTEMPTS) {
      console.error(`BLOCKER: could not clean .next/ after ${attempt} attempts:`, err.message);
      process.exit(1);
    }
    console.log(`  .next/ cleanup attempt ${attempt} hit ${err.code ?? err.message}, retrying in 2s...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

console.log("\n--- next build (production — this is what actually enables the Serwist service worker) ---");
status = run("pnpm", ["run", "build"]);
if (status !== 0) {
  console.error("\nBLOCKER: production build failed. Fix the build before this gate can run.");
  process.exit(status ?? 1);
}

console.log(`\n--- next start -p ${PORT} ---`);
const server = spawn("pnpm", ["exec", "next", "start", "-p", PORT], {
  stdio: "inherit",
  shell: isWin,
  env: loadedEnv,
});
server.on("error", (err) => {
  console.error("BLOCKER: could not start the production server:", err);
  process.exit(1);
});

let exitCode = 1;
try {
  await waitForServer(BASE_URL);
  console.log(`\n--- production server ready at ${BASE_URL} ---`);

  console.log("\n--- playwright test --config=playwright.offline.config.ts ---");
  const testStatus = run(
    "pnpm",
    ["exec", "playwright", "test", "--config=playwright.offline.config.ts"],
    { env: { ...loadedEnv, OFFLINE_BASE_URL: BASE_URL } },
  );
  exitCode = testStatus ?? 1;
} catch (err) {
  console.error("\nBLOCKER:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  server.kill();
}

if (exitCode === 0) {
  console.log("\npnpm test:offline PASSED — real offline capture + sync verified end to end.");
} else {
  console.error("\npnpm test:offline FAILED. This is a real blocker, not a false pass.");
}
process.exit(exitCode);
