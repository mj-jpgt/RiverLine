# 2026-08-17 — Product-wave integration sweep (orchestrator)

Final verification after W1 (shell) / W2 (A4 OCR) / W3 (security) / W4 (deploy)
merged, run independently on the settled tree.

## Defects found and fixed in integration

1. ESLint swept W2's vendored tesseract worker assets (82 "errors" in
   minified third-party code) → `public/tesseract-assets/**` added to lint
   ignores with rationale.
2. W3's auth rate limit (correct at 5/15min/email in production) broke the
   13-spec determination gate, which legitimately logs in ~10×/window →
   `AUTH_RATE_LIMIT_EMAIL/IP` env overrides with production-safe defaults,
   set only by the test wrappers. Never set these in production.

## Final-tree gate matrix (all run by orchestrator)

| Gate | Result |
|---|---|
| typecheck | PASS — 0 errors |
| lint | PASS — 0 errors (1 pre-existing warning) |
| vitest full | PASS — 32 files, 293/293 |
| root e2e chromium | PASS — 25/25 |
| offline gate (prod build, new CSP + shell) | PASS — 1/1 |
| determination+letters gate | PASS — 13/13 |
| A4 OCR gate (real tesseract in Chromium) | PASS — 4/4 |
| docker compose prove-out | PASS (W4 session; images/config unchanged since) |

## Manual walkthrough (screenshots delivered to user)

Drove the app live as the official role on riverline_test: landing →
magic-link login → role-aware home (real counts: 31 awaiting, 15 borderline)
→ registry search → structure detail → borderline-first review queue (real
ratios, adopted chip, calculation history) → dashboard (counts, CSV + records
export) → sign out. All screens render on-tokens, institutional, status
always label+color.

## Open items (honest ledger)

- WebKit-only navigation flake (pre-existing, root-caused by W4 as a probable
  double-navigation consuming the single-use token; needs a network trace
  before any token-semantics change).
- `output: "standalone"` one-line next.config change to shrink the 2.55GB
  image (documented in docs/deploy/self-host.md; deferred because
  next.config.ts was W3's file during the wave).
- Production login requires B4 (email provider) — user-owned.
- Determination review screen does not yet link to the estimates page for its
  assessment (module-boundary decision by W2; integration point documented).
- Viewer-role home branch verified by code review only (no viewer seed user).
- Build-time-only postcss CVE chain under pinned Next major (ADR needed to bump).
- Repo lives in OneDrive: `.next` readlink corruption recurs; documented
  workaround (delete `.next`) in the gate scripts. Moving the repo out of
  OneDrive remains the durable fix (ADR 0001).
