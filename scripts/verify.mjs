#!/usr/bin/env node
// pnpm verify — runs every gate AGENTS.md promises, in order, and reports a
// summary. It does NOT stop at the first failure: every subsequent agent
// needs to see the full picture, not just the first red light. It exits
// nonzero if any step fails, so it can never be a false "pass" for a PR.
import { spawnSync } from "node:child_process";

const steps = [
  ["typecheck", ["pnpm", "run", "typecheck"]],
  ["lint", ["pnpm", "run", "lint"]],
  ["test:unit", ["pnpm", "run", "test:unit", "--", "--run"]],
  ["test:e2e", ["pnpm", "run", "test:e2e"]],
  ["test:offline", ["pnpm", "run", "test:offline"]],
];

const results = [];

for (const [name, cmd] of steps) {
  console.log(`\n=== verify: ${name} ===`);
  const res = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = res.status === 0;
  results.push({ name, ok, status: res.status });
}

console.log("\n=== verify summary ===");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  (exit ${r.status})`}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(
    `\nverify FAILED: ${failed.map((f) => f.name).join(", ")}. This is a real blocker, not a false pass — see AGENTS.md "Definition of done".`,
  );
  process.exit(1);
}

console.log("\nverify PASSED.");
process.exit(0);
