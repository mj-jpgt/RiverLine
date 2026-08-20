# 2026-08-20 - Integration sweep after the emergency-readiness wave

Agents F1, F2, G1, G2, G3, G4 all merged. Orchestrator verification on the
settled tree, plus two real cross-agent integration bugs found and fixed.

## Cross-agent bugs the sweep caught and fixed

1. CSP vs motion (commit 7ea9df7). G1's design v2 added the `motion` library,
   which animates by setting inline style attributes at runtime. W3's earlier
   CSP set `style-src 'self' 'nonce-...'`, which blocks inline style
   attributes (nonces and hashes do not apply to style attributes, and a
   nonce disables 'unsafe-inline'). Result: animated elements could stay
   invisible. The offline gate caught it. Fix: `style-src 'self'
   'unsafe-inline'` (styles only; script-src stays strict nonce +
   strict-dynamic, the injection surface that matters). Verified live: the
   production CSP header now allows it.
2. Lockfile drift (commit f8842e0, earlier). motion in package.json without a
   matching committed lockfile broke every Vercel build. Fixed forward.

## F2 live sync fix (commit a9fd02f) - the user's reported failure

Two independent live causes:
- A UTF-8 BOM on the production STORAGE_DRIVER env var (and siblings) meant
  the driver name never matched, so every photo sync failed. Fixed live by
  re-setting the env vars cleanly; verified 500 -> 200.
- Vercel's ~4.5MB serverless body limit: multi-photo payloads hit 413. Fixed
  by uploading photos individually to a new /api/photos/upload endpoint
  before a metadata-only finalize sync. Verified live: endpoint returns 401
  (auth required), deploy green.

## Authoritative gate results (settled tree)

| Gate | Result |
|---|---|
| typecheck | PASS |
| lint | PASS (0 errors) after ignoring .scratch-* |
| vitest (serial, --no-file-parallelism) | PASS 470/470 (+5 skipped) |
| offline gate (per-photo sync, prod build) | PASS - proves F2's fix end to end |
| root e2e specs (isolated) | PASS - full-parallel failures are dev-server contention, reproduced in unrelated specs, green in isolation |

## Live production state

Latest deploy Ready. CSP fix live. New photo endpoint live. All 7 migrations
applied. 152,876 real parcels. Tenant isolation holds. Demo jurisdiction
walled off.

## Still open (honest)

- Full plain-language copy sweep of remaining stiff labels ("Borderline -
  requires review" style) across shared components - deferred to avoid churn
  during the wave, now safe to do on the quiet tree.
- Real email (Postmark key, B4) for self-service login.
- Real cost table + ordinance (jurisdiction procurement + the admin screens).
- root e2e full-parallel run needs --workers tuning to stop dev-server
  contention flakes producing false reds.
