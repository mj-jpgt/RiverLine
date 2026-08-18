# 0007 — OCR for contractor-estimate intake (A4): client-side tesseract.js

Status: Accepted
Date: 2026-08-17

## Context

T-W2 (A4, build spec §8) needs to read contractor repair estimates (photos
of paper/PDF documents) and pre-fill candidate line items + a candidate
total for a human to confirm — "OCR as an assist that pre-fills fields a
human confirms — never a data source that commits values" (spec §8, framing
paragraph). This is a new production dependency and AGENTS.md rule 3
requires an ADR + human decision before adding one; the orchestrator
pre-approved **tesseract.js** specifically and asked this task to verify the
real current version (not recall it) and record the decision here.

**Version verification** (not recalled — run for real, this session):
```
$ npm view tesseract.js version
7.0.0
```
Installed and pinned exactly: `corepack pnpm add tesseract.js@7.0.0` →
`package.json` dependencies now list `"tesseract.js": "7.0.0"` (no caret),
matching this project's pinned-version convention (AGENTS.md "Stack (pinned
— do not change without an ADR)").

## Options considered

**(a) Client-side WASM OCR (`tesseract.js` in the browser).** OCR runs
entirely in the assessor/official's browser, in a Web Worker, against the
photographed/scanned estimate document. No estimate image bytes ever need
to leave the browser to get OCR text back — only the final, human-confirmed
values (plus the raw extracted JSON, for audit) are POSTed to the server.

**(b) Server-side OCR in a route handler.** Upload the image bytes to a
Next.js API route, run `tesseract.js`'s Node worker there, return extracted
text/line-items/bboxes to the client for the same confirmation UI.

## Decision

**(a) Client-side.** Reasons, in order:

1. **Matches this project's own architecture rule for the serving path.**
   AGENTS.md's "Geospatial" section is explicit that the serving path stays
   boring and does no heavy compute at request time (raster joins, GDAL) —
   the same spirit applies here: OCR is CPU/wasm-heavy, bursty, and has no
   business running inside the same Next.js process that serves every other
   tenant's requests. Client-side keeps the server a plain CRUD path with no
   new CPU-spike surface, and needs zero new server infrastructure (no job
   queue, no worker process, nothing AGENTS.md rule 6 ("over-engineering")
   would flag).
2. **The confirmation UI (spec §8, mitigation 1) already needs the source
   image and the extracted bboxes in the browser together**, to render
   "extracted values render side-by-side with a crop of the source region."
   Running OCR client-side means the image never has to make a second round
   trip from server back to client just to draw that overlay — it's already
   there.
3. **No image upload is required before the assessor sees any OCR result.**
   A document photographed in the field, over a bad connection, gets OCR'd
   immediately from the in-memory `File`/`Blob` the camera/file input
   produced — the upload (and its sha256, spec's implicit content-addressing
   convention, matching `photos.sha256`) only has to happen once, after
   confirmation, alongside the confirmed values. Better fit for "field
   conditions... bad connection" (build spec §6) than a design that needs
   the raw image uploaded first just to get text back.
4. **Zero server dependency footprint change.** `tesseract.js`'s Node-side
   path pulls in `node-fetch`/native bindings behavion that would need to be
   verified safe inside a Next.js route handler's runtime (Node vs Edge,
   bundling of a real WASM binary into the server bundle); the browser path
   sidesteps all of that — the browser is already a WASM + Web Worker
   runtime with none of those open questions.

**Verified non-blocking for CDN reachability itself**, so (b) is not needed
as a fallback: `tesseract.js`'s browser worker resolves its worker script,
WASM core, and `eng.traineddata` language file from public CDNs by default
(`cdn.jsdelivr.net` for the worker/core, version-pinned to the exact
installed version; `cdn.jsdelivr.net/npm/@tesseract.js-data/eng/...` for the
language file — read directly from
`node_modules/tesseract.js/src/worker/browser/defaultOptions.js` and
`node_modules/tesseract.js/src/worker-script/index.js`, not assumed). All
endpoints were confirmed reachable via `curl` from this dev/test
environment.

**Real blocker found in this task's own browser testing (not CDN
reachability — CSP): `worker-src 'self'` and `connect-src 'self'`.**
`middleware.ts` (W3's concurrent security-hardening work, landed mid-flight
in this shared tree — `docs/security-review.md`) sets a strict
nonce/`'strict-dynamic'` CSP with `worker-src 'self'` and
`connect-src 'self'`, neither of which existed when this ADR's "Options
considered" section above was first drafted. Running the real upload →
OCR flow through a real Chromium browser (Playwright, this session)
surfaced two real, reproducible console errors:
```
Creating a worker from 'blob:http://localhost:3600/...' violates the
following Content Security Policy directive: "worker-src 'self'".
```
`tesseract.js`'s default `workerBlobURL: true` behavior wraps the
(cross-origin, CDN) `workerPath` in a same-origin `Blob`/`importScripts()`
wrapper specifically to sidestep the browser's same-origin Worker
restriction — but the `blob:` scheme itself is not in `worker-src`, so it's
rejected outright. A CDN-hosted `workerPath` loaded directly (`new
Worker(workerPath)`, `workerBlobURL: false`) would fail the same directive
for the opposite reason (cross-origin, not `'self'`). The `langPath` fetch
similarly can't reach `cdn.jsdelivr.net` under `connect-src 'self'`.

**Fix shipped (within this task's own paths — `middleware.ts` is W3's file,
never edited here): self-host every asset same-origin.**
`public/tesseract-assets/` (committed, see that directory's own README)
holds `worker.min.js`, the SIMD+LSTM `tesseract-core-simd-lstm.wasm{,.js}`
core variant, and `eng.traineddata.gz` — all copied byte-for-byte from the
installed npm packages (worker/core) or fetched once from tesseract.js's
own documented CDN source (lang data) and committed, never modified.
`src/modules/a4-estimates/ocr.client.ts`'s `createWorker()` call passes
`workerPath`/`corePath`/`langPath` pointing at these same-origin paths and
`workerBlobURL: false` (so `spawnWorker.js` does a plain `new
Worker(workerPath)`, no `blob:` at all). `corePath` is a specific `.js`
file (not a directory), which — per
`node_modules/tesseract.js/src/worker-script/browser/getCore.js` — skips
SIMD/relaxed-SIMD auto-detection entirely, so only the SIMD+LSTM variant
needed to be hosted (not every variant the auto-detection logic could
otherwise pick). Re-verified with the exact same real-browser Playwright
run after the fix: zero CSP violations, OCR completes, all four
`test/e2e/a4-estimates.spec.ts` tests pass.

No SharedArrayBuffer / cross-origin-isolation (`COOP`/`COEP`) headers were
needed for any of this: this project uses `tesseract.js`'s default
single-worker LSTM path, not the multi-threaded core.

## Consequences

- **Assets are self-hosted, not CDN-fetched (see "Real blocker found"
  above) — `public/tesseract-assets/` adds ~9.6MB to the repo** (worker
  ~109KB, core wasm+glue ~6.8MB, `eng.traineddata.gz` ~2.95MB). This is
  larger than a CDN-only approach would have cost the repo, but it is now
  REQUIRED for OCR to function at all under this app's CSP, not an
  optional hardening step — the CDN path is fully blocked by
  `worker-src 'self'`/`connect-src 'self'`, verified empirically, not
  theoretically. The browser still caches these same-origin assets after
  first fetch, same UX as the CDN approach would have had.
- This does NOT touch `src/core/capture/` (AGENTS.md's actual offline
  requirement — "the field capture flow... must work with the network
  fully disabled," `pnpm test:offline` merge blocker) — A4 is a separate
  add-on module (`src/modules/a4-estimates/`, `app/estimates/`), not part
  of the capture flow, and its own assets are same-origin static files
  (servable even from a fully local deploy) rather than a third-party CDN.
- **Only the SIMD+LSTM core variant is self-hosted**, not the non-SIMD
  fallback the CDN auto-detection path would have selected for an older
  browser (see "Real blocker found" above for why `corePath` deliberately
  points at one specific file). Open item for a follow-up: a
  non-SIMD-capable browser hitting `/estimates/.../new` would fail to
  instantiate the wasm core; every modern evergreen browser (including
  Safari 16.4+, this project's real deployment target per ADR 0002)
  supports WASM SIMD, so this is a low-probability gap, not a known-broken
  path — documented honestly rather than silently accepted.
- **`tesseract.js-core` and its transitive deps** (`wasm-feature-detect`,
  `idb-keyval`, `bmp-js`, `is-url`, `node-fetch`, `regenerator-runtime`,
  `zlibjs`) are installed as `tesseract.js`'s own declared dependencies
  (`node_modules/tesseract.js/package.json`) — not separately added, not a
  second ADR-worthy dependency decision.
- OCR is invoked only from `"use client"` code inside
  `src/modules/a4-estimates/` / `app/estimates/`, via a dynamic
  `await import("tesseract.js")` at the point OCR actually runs (not a
  static top-level import), so it never enters the server bundle or any
  page's initial client bundle weight until an assessor actually uploads a
  document.
- Every §8 mitigation this ADR's decision has to support (extracted values
  never auto-committed, human must tap the total row, totals must
  reconcile, mandatory scope checkbox, sanity bound, manual-entry fallback)
  is implemented in `src/modules/a4-estimates/` and `app/estimates/` and
  itemized file-by-file in `docs/journal/2026-08-17-w2-estimates.md`.

## Sources

- `npm view tesseract.js version` → `7.0.0`, run in this session (not
  recalled from training data).
- `node_modules/tesseract.js/package.json` — dependencies list, read
  directly.
- `node_modules/tesseract.js/src/worker/browser/defaultOptions.js` — CDN
  `workerPath` default, read directly.
- `node_modules/tesseract.js/src/worker-script/browser/getCore.js` — CDN
  `corePath` default + SIMD/relaxed-SIMD/LSTM-only variant selection logic,
  read directly.
- `node_modules/tesseract.js/src/utils/resolvePaths.js` — confirms
  `corePath`/`workerPath`/`langPath` are the only override points, read
  directly.
- CDN reachability: `curl -o /dev/null -w '%{http_code}'` against
  `cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js`,
  `cdn.jsdelivr.net/npm/tesseract.js-core@6/tesseract-core-simd-lstm.wasm.js`,
  and `cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`
  — all `200`, run in this session.
- `middleware.ts` — read directly to get the exact CSP directives
  (`worker-src 'self'`, `connect-src 'self'`, nonce + `'strict-dynamic'`
  for `script-src`), not assumed from `docs/security-review.md`'s prose
  alone.
- `node_modules/tesseract.js/src/worker/browser/spawnWorker.js` — confirms
  `workerBlobURL: true` (the default) wraps `workerPath` in a `Blob`/
  `importScripts()` before calling `new Worker(...)`, and that
  `workerBlobURL: false` calls `new Worker(workerPath)` directly instead.
  Read directly.
- Real-browser proof: Playwright (Chromium) against a real `next dev`
  instance on port 3600, both before the self-hosting fix (console showed
  the exact `worker-src 'self'` violation quoted above) and after (zero
  console errors, `test/e2e/a4-estimates.spec.ts` all 4 tests pass) — see
  `docs/journal/2026-08-17-w2-estimates.md` for the full command output.
