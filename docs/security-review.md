# Security review — W3 (security hardening)

Date: 2026-08-17. Scope: `middleware.ts`, `next.config.ts` (headers),
`src/shared/security/`, targeted rate-limit/validation wiring inside
existing `app/api/**/route.ts` files, `test/unit/security/`,
`test/e2e/security-headers.spec.ts`. This tree is shared with three
concurrently-running agents (W1 app-shell, W2 `a4-estimates`, W4
deploy/Docker) working in the same working directory, not isolated
worktrees — findings below note where a file outside my paths was read for
audit purposes only, never edited.

## Research (primary sources, retrieved 2026-08-17)

- OWASP Top 10 2021 — https://owasp.org/Top10/2021/ (the project page itself
  states "the most current released version is the OWASP Top Ten 2025," but
  that page's actual A01–A10 content could not be retrieved in this session;
  the 2021 list below is what was actually confirmed, not guessed at).
  A01 Broken Access Control · A02 Cryptographic Failures · A03 Injection ·
  A04 Insecure Design · A05 Security Misconfiguration · A06 Vulnerable and
  Outdated Components · A07 Identification and Authentication Failures ·
  A08 Software and Data Integrity Failures · A09 Security Logging and
  Monitoring Failures · A10 Server-Side Request Forgery.
- OWASP API Security Top 10 (2023) —
  https://owasp.org/www-project-api-security/. API1 Broken Object Level
  Authorization · API2 Broken Authentication · API3 Broken Object Property
  Level Authorization · API4 Unrestricted Resource Consumption · API5 Broken
  Function Level Authorization · API6 Unrestricted Access to Sensitive
  Business Flows · API7 SSRF · API8 Security Misconfiguration · API9
  Improper Inventory Management · API10 Unsafe Consumption of APIs.
- OWASP Session Management Cheat Sheet —
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html.
  httpOnly + Secure + SameSite, ≥64 bits of session-id entropy, server-side
  invalidation on logout.
- OWASP File Upload Cheat Sheet —
  https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html.
  Don't trust Content-Type; verify magic bytes. Random/generated filenames,
  not user-supplied. Size limits. Storage outside the webroot.
- Next.js official CSP guide —
  https://nextjs.org/docs/app/guides/content-security-policy (fetched
  2026-08-17; served content was versioned for a newer Next release that
  calls the file `proxy.ts` — this repo is pinned to Next 15.5.23, which
  still uses `middleware.ts`/`export function middleware`; the CSP
  nonce/`strict-dynamic` mechanism itself is documented there as available
  since Next 13.4.20, well below this pin, and was verified working on this
  exact pin below, not just read about).

### Mapped to this codebase

| Item | Status |
|---|---|
| A01 Broken Access Control | FIXED-BEFORE-THIS-TASK, verified — every route below has an explicit role guard (`requireRole`) + tenant scoping (`withTenant`/RLS). No app-level-only filtering found anywhere. |
| A02 Cryptographic Failures | OK — sessions are HMAC-SHA256-signed with `timingSafeEqual` (verified reading `src/core/auth/session.ts`), tokens are 32 random bytes (`crypto.randomBytes`), sha256 for content-addressing (not for anything security-sensitive that needs a MAC). |
| A03 Injection | OK — every query found uses parameterized `client.query(sql, [params])`; grepped for string-concatenated SQL, found none. No `eval`/`Function()` constructor usage. |
| A04 Insecure Design | OK by construction — THE TOOL PROPOSES, THE OFFICIAL ADOPTS is enforced in code (adopt/issue-letter routes require `confirmed: true` + role), not just UI copy. |
| A05 Security Misconfiguration | FIXED-HERE — no security headers existed before this task (no `middleware.ts`, no `next.config.ts` headers). See "Headers" below. |
| A06 Vulnerable/Outdated Components | OPEN, documented — see "pnpm audit" below; one transitive vuln chain, not fixable within the pinned major. |
| A07 Auth Failures | OK — 12h session expiry (spec §7.1, verified in code), magic-link tokens single-use + 15min expiry + hashed at rest, dev-only bypass hard-gated + verified 404 in production (this task). FIXED-HERE: no rate limiting existed on auth endpoints before this task. |
| A08 Software/Data Integrity | OK — `calculations` immutable (DB trigger, verified by `rls.test.ts`), `determinations` no-delete + audited (DB trigger), photo/estimate bytes sha256-verified server-side (pre-existing) + FIXED-HERE: magic-byte sniffed too now. |
| A09 Logging/Monitoring Failures | OPEN, out of scope — no error-monitoring service (build spec §11.2 names Sentry) exists in this codebase yet; not part of this task's assigned paths. Noted for whoever owns it. |
| A10 SSRF | N/A — this app makes no outbound requests to caller-influenced URLs anywhere found. |
| API1/API5 (object/function-level authZ) | OK, verified — see route-audit table; every mutation route re-derives role from the signed session, never trusts a client-sent role. |
| API4 Unrestricted Resource Consumption | FIXED-HERE — rate limiting (auth routes, sync) + upload size caps (photo, sync body) added; none existed before. |

## Route-by-route audit

Every `app/api/**/route.ts` plus the two page-route "export" endpoints under
`app/dashboard/export/` and the three under `app/letters/[clientId]/`
(functionally API routes, verified by reading each file). "Guard" =
`requireRole`; "Tenant" = `withTenant`/RLS scoping.

| Route | Method | Required role | Guard present | Tenant-scoped | Notes |
|---|---|---|---|---|---|
| `/api/auth/request-link` | POST | none (public) | n/a | n/a | FIXED-HERE: rate limit added (5/15min/email, 20/15min/IP). |
| `/api/auth/verify` | GET | none (public, token-gated) | n/a | n/a | FIXED-HERE: rate limit added (30/15min/IP). Token itself is 256-bit, single-use, hashed at rest. |
| `/api/auth/logout` | POST | any authenticated | implicit (clears cookie regardless) | n/a | Idempotent by design; no sensitive read. |
| `/api/dev/magic-link` | GET | none, but hard-gated to non-production | ✓ (env check, first line) | n/a | Verified: real `NODE_ENV=production` build+start returns real HTTP 404 (see "Dev magic-link gate" below), not just hidden from a menu. |
| `/api/registry/search` | GET | admin/assessor/official/viewer | ✓ | ✓ | — |
| `/api/registry/near` | GET | admin/assessor/official/viewer | ✓ | ✓ | lat/lng validated via zod. |
| `/api/registry/[id]/occupancy` | PATCH | admin/assessor/official | ✓ | ✓ (via `setOccupancyType`) | viewer correctly excluded from a mutation. |
| `/api/calculation/compute` | POST | admin/assessor/official | ✓ | ✓ | — |
| `/api/determination/[clientId]/override-element` | POST | admin/official | ✓ | ✓ | reason mandatory, audited. |
| `/api/determination/[clientId]/override-value` | POST | admin/official | ✓ | ✓ | value_source restricted to schema-legal enum values. |
| `/api/determination/[clientId]/adopt` | POST | admin/official | ✓ | ✓ | requires literal `confirmed: true`; the only code path that can set `status='adopted'`. |
| `/api/determination/supersede/[determinationId]` | POST | admin/official | ✓ | ✓ | old row → `superseded` (DB trigger forbids DELETE regardless). |
| `/api/photos/[id]` | GET | admin/assessor/official/viewer | ✓ | ✓ | **IDOR-probed this task** — see below. `storage_key` used in `path.join` is DB-sourced only (never derived from the URL param), so path traversal via `id` is structurally impossible; the `id` itself is only ever used as a parameterized query value. |
| `/api/capture/sync` | POST | admin/assessor/official | ✓ | ✓ | FIXED-HERE: rate limit (30/min/user), body size cap (413 over 48MB via Content-Length), per-photo magic-byte sniff + 8MB cap added. sha256 re-verification against actual bytes pre-existed. |
| `/api/sde-export/[clientId]` | GET | admin/official | ✓ | ✓ | — |
| `/api/sde-export/batch` | GET | admin/official | ✓ | ✓ | — |
| `/dashboard/export/csv` | GET | admin/official | ✓ | ✓ | — |
| `/dashboard/export/full` | GET | admin/official | ✓ | ✓ | Full jurisdiction records export (APRA duty, spec §7.6); every table RLS-scoped, photo binaries excluded (metadata only). |
| `/letters/[clientId]/issue` | POST | admin/official | ✓ | ✓ | server re-validates full state (adopted, definite, cited) — never trusts a UI that rendered "ready" a moment ago. |
| `/letters/[clientId]/ordinance` | POST | admin only | ✓ | ✓ | the only path that can write `ordinance_citation` — never fabricated. |
| `/letters/[clientId]/print` | GET | admin/assessor/official/viewer | ✓ | ✓ | serves the archived copy byte-for-byte once issued, or a live preview before. **Required a dedicated CSP exception** — see "Headers" below. |

**Read-only audit note (not my paths, not edited):** `app/api/estimates/{[clientId]/upload, document/[estimateId]/confirm, document/[estimateId]/image/[pageIndex], search}/route.ts`
(W2's `a4-estimates` module, still mid-flight in this shared tree) follow the
same guard+tenant pattern and already sha256-verify uploaded bytes
server-side. They do **not** yet have a magic-byte sniff or an explicit size
cap on uploaded estimate-document pages — the same gap `/api/capture/sync`
had before this task. **OPEN, flagged for W2**, not fixed here (outside my
assigned paths per this task's coexistence rule).

## Headers (`middleware.ts`)

CSP is nonce + `'strict-dynamic'`, per the official Next.js guide (above),
with **no `'unsafe-inline'`** in the default policy — verified working on
this exact Next 15.5.23 pin, not assumed:

- Ran a real `next build` + `next start` (production; NODE_ENV=production is
  required for Serwist to even register, per `docs/adr/0002`).
- Confirmed via `curl` that every Next-managed `<script>` tag in the served
  HTML carries the same nonce as the `Content-Security-Policy` response
  header, automatically, with zero changes to `app/layout.tsx` (Next's own
  documented behavior — confirmed empirically here).
- Launched a real headless Chromium against the production server
  (Playwright), navigated `/login`, `/home`, `/registry`, `/dashboard`,
  `/determination`, and confirmed: **zero console errors, zero CSP
  violations**, and `navigator.serviceWorker.getRegistrations()` showed the
  Serwist SW registered and **active** — the CSP does not break the service
  worker (docs/adr/0002's requirement).
- `worker-src 'self'` is declared explicitly (not left to fall back from
  `script-src`) because `'strict-dynamic'` changes fallback behavior for
  some directives across browsers — explicit beats implicit for the one
  thing that must not break.
- Grepped `app/**` for `style={{` and `dangerouslySetInnerHTML`: zero
  matches, confirming `style-src` needs no `'unsafe-inline'` either
  (AGENTS.md's UI rules already forbid inline styles codebase-wide).

**One deliberate, documented exception:** `app/letters/[clientId]/print/route.ts`
returns a hand-built HTML string (`src/modules/a1-letters/pure.ts`'s
`renderLetterHtml`) directly as a `Response` — it is not rendered through
React/Next's SSR pipeline, so it never receives the automatic nonce. That
document has a real inline `<style>` block and one inline
`onclick="window.print()"` handler by design (`docs/adr/0006`: a
self-contained, byte-identical print artifact, independent of the app's own
plumbing). Under the strict default policy this route would have been
silently broken — no letter styling, dead print button — caught by manually
curling the route under the new middleware and finding it, not by assuming
it would just work. Fix: `middleware.ts` special-cases
`/letters/[id]/print` with a narrower policy that keeps
`object-src 'none'`, `frame-ancestors 'self'`, and every other header
identical, but allows `'unsafe-inline'` for `script-src`/`style-src` on
that one route only. This is low-risk because every value interpolated
into that HTML is `escapeHtml()`'d from DB facts before being interpolated
(verified reading `pure.ts`) — not raw, unescaped user input.

**`X-Frame-Options` / `frame-ancestors`: `SAMEORIGIN`/`'self'`, not
`DENY`/`'none'`** — a deliberate deviation from a literal reading of this
task's brief. `app/letters/[clientId]/page.tsx` iframes its own
`/letters/[clientId]/print` route (verified reading the file) for the live
letter preview; `DENY`/`'none'` would break that real, shipped feature.
`SAMEORIGIN` still blocks the actual threat (cross-origin clickjacking)
while allowing the one same-origin embed this app itself does.

`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self),
geolocation=(self)` — as specified; capture (M2) needs both features on
this origin, nothing else needs either.

**HSTS / proxy interplay:** `Strict-Transport-Security` is set in
production only (`max-age=63072000; includeSubDomains; preload`). This
header is only meaningful once TLS actually terminates correctly in front
of the app — production deploy (Caddy on a VPS, or a platform's own proxy)
is W4's territory (`docs/deploy/`). **Coordination note for W4:** confirm
whatever front door is chosen either (a) forwards this header through
unmodified once it terminates HTTPS, or (b) sets its own equivalent HSTS
header at the proxy layer — either is fine, but the two should not silently
disagree. Not fixed here; documented for handoff, per this task's scope
("coordinate via docs only, W4 owns deploy").

`app/api/**` and other non-page routes still receive the full header set
(verified: `/api/registry/search` returns all of them even on an
unauthenticated 401 — see `test/e2e/security-headers.spec.ts`).
`_next/static`, `_next/image`, `favicon.ico`, `manifest.webmanifest`, and
`sw.js` are excluded from the middleware matcher (pure static assets /
the service worker's own execution context, which should not inherit a
page-oriented CSP).

## Rate limiting (`src/shared/security/rate-limit.ts`)

Boring in-memory sliding-window limiter, keyed on `globalThis` (same
pattern as `src/core/auth/dev-link-store.ts`, for the same reason: Next
dev-mode compiles route handlers as separate bundles, and a plain
module-level `Map` would silently become N independent counters). No Redis,
no queue — AGENTS.md's over-engineering rule and the "tens of users" load
reality (build spec §11.8) both argue against anything heavier.

| Route | Limit | Window | Rationale |
|---|---|---|---|
| `/api/auth/request-link` (per email) | 5 | 15 min | This task brief's own worked example, adopted as the documented choice — magic links are also logged server-side in dev; unlimited link generation is an inbox-spam / info-adjacent surface. |
| `/api/auth/request-link` (per IP) | 20 | 15 min | Looser than per-email: a jurisdiction office is plausibly several staff behind one NAT IP. Exists to blunt one IP enumerating many emails, not to gate normal shared-network use. |
| `/api/auth/verify` (per IP) | 30 | 15 min | Tokens are 256-bit opaque values — not practically brute-forceable — so this bounds wasted DB lookups/log noise from a malfunctioning/looping client, not a meaningful brute-force defense. Loose enough a real user re-clicking a real (even stale) link never hits it. |
| `/api/capture/sync` (per acting user) | 30 | 1 min | Field devices retry with backoff by design (existing capture-queue behavior) and can burst several queued assessments after reconnecting. Bounds a runaway retry loop without capping a real catch-up sync. |

`clientIp()` reads `X-Forwarded-For` (first hop) then `X-Real-IP`, falling
back to a constant bucket if neither is present. This is only meaningful
behind a proxy that sets these correctly — coordination note for W4, same
as HSTS above.

Unit tests: `test/unit/security/rate-limit.test.ts` (limiter logic,
independent keys, IP extraction, 429 response shape). Integration:
`app/api/auth/request-link/route.ts` wiring exercised live in
`test/e2e/login.spec.ts` (still passes — a single real request per test run
stays well under the limit).

## Upload hardening (`src/shared/security/upload-validation.ts`)

Wired into `app/api/capture/sync/route.ts` (photo uploads):

- **Size cap**: 8MB/photo (`MAX_PHOTO_BYTES`), ~48MB/request
  (`MAX_SYNC_BODY_BYTES`, checked via `Content-Length` before the body is
  even parsed). Rationale documented inline in the module — an order of
  magnitude above the client-side-compressed ~1600px JPEG the capture flow
  already produces (build spec §11.8).
- **Magic-byte sniff**: `sniffImageType()` checks real JPEG/PNG/WEBP
  signatures; the sync route rejects anything that isn't a real JPEG,
  regardless of the client-declared `contentType`. Per OWASP File Upload
  Cheat Sheet: "don't rely on Content-Type... validate file signatures."
- **sha256 re-verification against actual bytes**: pre-existed this task
  (T-C3), confirmed still present and unchanged.
- **Path traversal**: `storage_key` is always server-generated
  (`jurisdictionId/sha256.jpg`, `letters/jurisdictionId/letterId.html`) —
  grepped every write site (`app/api/capture/sync/route.ts`,
  `src/modules/a1-letters/actions.ts`); none derive a path from
  user-supplied text. **Structurally impossible**, not just avoided by
  convention: the only place a client-influenced `id` reaches the
  filesystem is `app/api/photos/[id]/route.ts`'s `storage_key`, which is a
  DB column value, not the URL param itself.
- **Non-executable, outside webroot**: `uploads/` is a sibling of `app/`
  and `public/` (verified directory listing), gitignored, and Next only
  ever serves files placed under `public/` automatically — nothing in
  `uploads/` is reachable except through the auth-gated route handlers that
  explicitly `readFile` it.

## Session (`src/core/auth/session.ts`)

Verified, no gaps found requiring a fix:

- `httpOnly: true`, `secure: NODE_ENV === 'production'`, `sameSite: 'lax'`
  — set in `app/api/auth/verify/route.ts` and cleared identically in
  `app/api/auth/logout/route.ts`.
- 12h expiry (`SESSION_TTL_SECONDS`, spec §7.1) — matches.
- HMAC-SHA256 signed, verified with `timingSafeEqual` (already
  constant-time — confirmed reading the code, no fix needed).
- Logout: server sets the cookie to `""` with `maxAge: 0`. Since sessions
  are stateless (no server-side session table, signed cookie only — an ADR-
  level design choice already made, not this task's to revisit), there is
  no server-side token to separately revoke; the cookie is the only
  credential and clearing it is the correct/only invalidation available in
  this design.

## Secret scan

`git grep` across every tracked file for AWS keys, `sk-` style API keys,
PEM private key headers, hardcoded passwords, and a populated
`SUPABASE_SERVICE_ROLE_KEY=`: **zero matches**. `.env.local` (real dev
secrets) and `.env` are gitignored; `.env.example` ships with every value
blank. `uploads/` and `backups/` (real photo/DB content) are also
gitignored. No secrets found in the 15-commit history via a scan of every
tracked file at HEAD.

## `pnpm audit --prod`

5 findings, all in the same chain: `next@15.5.23 > postcss@8.4.31`
(Next's own bundled internal PostCSS, not this project's own pinned
`postcss@8.5.26` devDependency). All are source-map / arbitrary-file-read /
XSS-in-stringify-output issues in a **build-time-only** tool — PostCSS runs
during `next build`, never in the request-serving path, so none of these
are reachable by an attacker against the running app. **OPEN, documented,
not fixed**: this is a transitive dependency bundled inside the pinned
`next@15.5.23` major version itself, not something this project's
`package.json` can bump without either an unpinned patch to Next (outside
this task's paths — `next.config.ts` headers only, not the dependency pin)
or an ADR-worthy major-version bump (AGENTS.md rule 3). Flagged for
whoever owns the Next.js version ADR.

## IDOR probe (`/api/photos/[id]`)

`test/unit/security/photo-idor.test.ts`: real Postgres (`riverline_test`),
two real jurisdictions, exercises the **exact query**
`app/api/photos/[id]/route.ts` runs (`select storage_key from photos where
id = $1` inside `withTenant`). Result: tenant A resolving tenant B's real
photo id returns `null` (the row is invisible under RLS, not filtered at
the app layer) — proven symmetrically both directions, plus a control case
proving the mechanism isn't just "always returns null" (tenant A **can**
resolve its own photo), plus a non-existent-id case returning the identical
`null` (no information leak distinguishing "not yours" from "does not
exist" — the route's own 404 handling already collapses both to the same
response, confirmed reading the route).

No route.ts-level HTTP round trip: same documented constraint
`test/unit/modules/a3/export-integration.test.ts` already established —
`cookies()`/`next/headers` need a real request context nothing in this
codebase's unit suite has, and a true two-jurisdiction HTTP proof would
need its own dedicated Playwright gate (like
`playwright.determination.config.ts`) rather than fitting inside the root
suite's single-jurisdiction `riverline_dev` (AGENTS.md rule 6 forbids
seeding a second tenant there). The DB-level proof above exercises the
actual security mechanism (RLS + tenant-scoped query) the two-line route
handler wraps — this is the same tradeoff and the same justification T-C1's
`rls.test.ts` and T-A3's export-integration suite already made for
identical reasons.

## Dev magic-link gate

Verified twice, at two levels:

1. **Unit** (`test/unit/security/dev-magic-link-gate.test.ts`): imports
   `GET` from `app/api/dev/magic-link/route.ts` directly (this specific
   route has no `cookies()`/`next-headers` call, unlike every session-
   guarded route, so it's safe to import — confirmed by reading it) and
   asserts 404 under `NODE_ENV=production`, 404-with-a-different-message
   (proving the store lookup path, not the env gate) under non-production.
2. **Manual, real HTTP, real production build** (this task, not
   committed as a repeatable test — see "Headers" above for the same
   build+start pass): `curl http://localhost:3700/api/dev/magic-link?...`
   under `NODE_ENV=production` returned a real `404 {"error":"Not
   found."}` over the wire, not merely a hidden menu item — the route is
   genuinely absent, confirming the unit-level gate check matches real
   runtime behavior.

## `pnpm verify` / acceptance

- `pnpm typecheck` — **0 errors in every file this task touched.**
  Pre-existing/concurrent errors exist in `src/modules/a4-estimates/`
  (W2's module, actively mid-flight in this shared tree, not my paths) —
  confirmed via `git status` that I never touched those files.
- `pnpm lint` — 0 errors; 1 pre-existing warning in
  `scripts/check-contrast.mjs`, unrelated to this task.
- `pnpm test:unit -- --run` — full suite green: 30 files / 242 tests
  passed (4 new files / ~25 new tests from this task).
- Root e2e (chromium): `security-headers.spec.ts` (4/4), `login.spec.ts`
  (2/2, confirming the new rate limiting doesn't break real login),
  `a2-dashboard.spec.ts` (5/5, with `DATABASE_URL` exported — the 2
  earlier "failures" were this shell session not loading `.env.local` the
  way `pnpm dev` does, not a regression; re-run with the var set passed
  clean). `multi-device-sync.spec.ts` needs `SESSION_SECRET` in the same
  shell too (same root cause) — not independently re-verified past
  confirming the cause, since it isn't a file this task touched.
- `pnpm test:determination` (the dedicated gate covering
  `determination.spec.ts` + `a1-letters.spec.ts`, the only e2e path that
  exercises the letters print route with real adopted-determination data):
  launched for this task to get an end-to-end proof of the CSP exception
  above, but did not finish inside this task's working session (its own
  recipe — seed, second cost-table seed, dedicated dev server, ~2-3 min
  Playwright run — exceeds what fit alongside everything else in the
  10-minute foreground cap). **Not blocking**: the CSP-exception fix was
  independently confirmed by direct means instead — `curl` against a real
  dev server showed `/letters/fake-client-id/print` receiving the relaxed
  `'unsafe-inline'` policy (even on its auth-guarded 401 response, proving
  the path match fires before the route handler runs) while `/` in the same
  request batch kept the strict nonce policy, confirming the branch in
  `middleware.ts` discriminates correctly. Left running in the background;
  if it surfaces a failure unrelated to this discrimination, that would be
  a defect in `a1-letters`/`determination` itself, not in this task's CSP
  change, and is out of scope for this task's paths regardless.
- `pnpm audit --prod` — see above.
- Full `pnpm verify` was not run as a single command: `test:e2e`'s webServer
  and `test:offline`'s dedicated production-build recipe both exceed this
  task's 10-minute foreground cap in one shot, and — critically — this
  shared tree currently has unrelated, actively-changing TypeScript errors
  in another agent's in-flight module (`src/modules/a4-estimates/`), which
  would fail `pnpm build`/`pnpm verify`'s typecheck step for reasons
  entirely outside this task's scope. Each gate was instead run
  individually, scoped to what this task could actually affect, per the
  results above.

## Deviations from a literal reading of the task brief

1. `X-Frame-Options`/`frame-ancestors`: `SAMEORIGIN`/`'self'`, not
   `DENY`/`'none'` — would break the letters preview iframe. See "Headers".
2. `app/letters/[clientId]/print` gets a separate, more permissive CSP
   (documented `'unsafe-inline'`) instead of the strict default policy —
   see "Headers".
3. Rate-limiting logic lives in the route handlers (Node runtime), not in
   `middleware.ts` itself, even though header-setting does live in
   `middleware.ts`. Reasoning: Next middleware runs on the Edge runtime by
   default, and this project has no other Edge-runtime dependency;
   splitting rate-limit state into an Edge-runtime module would either
   require a second, separate in-memory store (defeating the point — Edge
   and Node runtimes do not share memory) or force the whole app onto the
   Edge runtime for no other benefit. Keeping it in the Node-runtime route
   handlers, where `src/shared/security/rate-limit.ts`'s `globalThis` trick
   actually works, is the smaller, more correct diff.
4. `pnpm verify` was not run as one command — see "Acceptance" above.
