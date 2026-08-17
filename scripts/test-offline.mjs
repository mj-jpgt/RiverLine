#!/usr/bin/env node
// pnpm test:offline — merge blocker per AGENTS.md: "the field capture flow
// (src/core/capture/) must work with the network fully disabled and sync
// later."
//
// There is no capture flow yet: src/core/capture/ is an empty scaffold
// directory (this toolchain task only stood up the skeleton). There is
// therefore nothing to disable the network for and nothing to assert
// against. Rather than fake a pass — which AGENTS.md explicitly forbids
// ("Never make a gate lie") — this script fails loudly and says why.
//
// TODO(capture module agent): replace this with a real test that launches
// the app, disables the network route (Playwright `context.route`/
// `page.context().setOffline(true)` or a service-worker-level block),
// drives the real capture UI, and asserts the assessment is queued in
// IndexedDB and later synced. Wire it into test/e2e/offline-capture.spec.ts.

console.error(
  [
    "BLOCKER: pnpm test:offline is not yet implemented.",
    "",
    "Reason: src/core/capture/ has no capture flow to test yet (empty",
    "scaffold directory only). There is no offline-capable UI, no",
    "IndexedDB write queue, and no sync logic to exercise with the network",
    "disabled.",
    "",
    "This script intentionally exits nonzero instead of reporting a false",
    "pass. Per AGENTS.md, pnpm test:offline is a merge blocker; do not",
    "remove this failure without replacing it with a real offline test.",
  ].join("\n"),
);
process.exit(1);
