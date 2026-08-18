# 2026-08-18 — Live-readiness wave integration sweep (orchestrator)

After W5 (admin console) + V1 (storage) + V2 (email) + V3 (motion) + V5
(data hygiene/architecture) all merged.

## Final-tree gate matrix (orchestrator-run, settled tree)

| Gate | Result |
|---|---|
| typecheck | PASS |
| lint | PASS (0 errors) |
| vitest full | PASS — 386/386 (+5 skipped: live-credential contract tests) |
| root e2e chromium (31 specs) | PASS — 31/31 via playwright.alt-port.config.ts on :3050, workers=2 |
| offline gate (prod build + V3 motion CSS) | PASS — clears V3's unverified debt |
| determination+letters gate | PASS 13/13 (W5 session, tree unchanged since) |
| admin gate | PASS 4/4 (W5 session) |
| live Supabase storage contract | PASS 4/4 against the real project (V1 session) |

## Environment notes

- Port 3000 is occupied by an UNRELATED app (`C:\Temp\telo-web`, `next start`
  bound to 127.0.0.1). Killing it was blocked by policy — correctly, it is not
  ours. Root suite therefore runs via playwright.alt-port.config.ts (E2E_PORT).
  The user's Riverline dev server runs on :3001.
- Full-suite single-server contention causes one-off spec flakes at default
  workers; --workers=2 is reliable. Worth a config default later.

## Deploy status

Code-side Vercel readiness is DONE (storage driver, email transport, admin
console for jurisdiction data). Deployment blocked ONLY on user-supplied
credentials: (1) Supabase Transaction-pooler connection string — the direct
DB host is IPv6-only and unroutable from this network; ~20 pooler regions
probed, tenant not found, so the exact hostname must come from the dashboard
Connect dialog; (2) `vercel login`; (3) later, a Postmark server token (ADR
0009) for real magic-link email.
