# 2026-08-17 — Integration sweep after the parallel add-on wave (orchestrator)

Full-tree verification after T-A1/T-A2/T-A3 merged, run independently of the
build agents' own reports.

## Defect found and fixed

`test/e2e/a1-letters.spec.ts` hardcoded its isolated-run port (3400), so the
root Playwright suite picked it up and failed with ERR_CONNECTION_REFUSED.
Root cause: the spec cannot run against `riverline_dev` at all — its flow
needs a cost table, and dev's empty `cost_tables` is intentional
(constitution §2). Fix: joined it to the existing dedicated gate —
`playwright.determination.config.ts` now matches `(determination|a1-letters)`,
root config ignores it, spec defaults to the gate's port with the
`A1_BASE_URL` override preserved. Classic parallel-wave seam: every agent
green in isolation, defect only visible on the integrated run.

## Final-tree gate results (all run by orchestrator, this tree)

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS — 0 errors |
| `pnpm lint` | PASS — 0 errors, 1 pre-existing warning (scripts/check-contrast.mjs) |
| `vitest run` (full) | PASS — 24 files, 212/212 |
| root e2e chromium | PASS — 14/14 |
| determination+letters gate | PASS — 13/13 (1.6m) |
| offline gate | PASS on this tree (T-C6/C7 session; config untouched since) |

Notes: the composite gate wrappers exceed this environment's 10-minute
foreground command cap; steps were run split (seed → cost-table seed →
detached `next dev` on 3100 against riverline_test → playwright config run →
kill server). The `.next` readlink EINVAL corruption (OneDrive) reappeared
once during the sweep; fixed by the documented clean-`.next` workaround.

## Open items after integration

- Mobile-safari magic-link flake (dev-only login store race) — pre-existing,
  documented in T-C2/T-C3/T-C4 journals; does not affect chromium suites or
  production auth (dev transport only). Worth a dedicated small fix task.
- `scripts/db/migrate.mjs` TOCTOU race under parallel vitest workers (flagged
  by T-C6/C7) — needs an advisory lock; one-line-ish fix, unowned.
- Live-device testing (real iPhone) per docs/testing/live-test-plan.md — human.
- docs/BLOCKERS.md B1–B4 — human (cost guide, ordinance text, assessor call,
  email provider).
