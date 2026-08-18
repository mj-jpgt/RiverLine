# 2026-08-17 — T-W2: A4 contractor-estimate intake (OCR-assisted, human-confirmed)

## What I did

Built A4 end-to-end per `docs/riverline-sdd-build-spec.md` §8: upload a
contractor repair estimate document, run OCR client-side, and require a
human to individually verify every value before anything is stored as
confirmed. Nothing here ever auto-commits an OCR-extracted number.

- **`migrations/0005_contractor_estimates.sql`** — additive, `schema/core.sql`
  untouched. The literal `estimates` table shape given in the task,
  reproduced exactly, plus an explicit RLS policy (`estimates_tenant`,
  same shape as every other tenant-scoped policy in `schema/core.sql`'s own
  `do $$ ... foreach t in array [...]` block — this table postdates that
  frozen file, so it's not in that array and needed the policy written by
  hand) and an explicit `grant select, insert, update, delete on estimates
  to riverline_app` — **a real gap this task's own integration tests
  caught**, not invented: `migrations/0003_app_role.sql`'s
  `grant ... on all tables in schema public` is a snapshot at the time it
  ran, and does not retroactively cover a table created two migrations
  later. First test run against a freshly-migrated `riverline_test` failed
  with a real `permission denied for table estimates` from `riverline_app`;
  fixed in the migration file itself (line ~85) and applied out-of-band to
  the already-migrated `riverline_dev`/`riverline_test`.

- **`docs/adr/0007-ocr-estimate-intake.md`** — tesseract.js version verified
  for real (`npm view tesseract.js version` → `7.0.0`, not recalled),
  installed pinned exactly. Decision: client-side WASM OCR. **Discovered
  mid-build (not assumed): the CDN-default asset-loading path is fully
  blocked by this app's CSP** (`middleware.ts`, W3's concurrent security
  hardening — `worker-src 'self'` rejects both the cross-origin CDN worker
  script and the `blob:` URL tesseract.js wraps it in by default;
  `connect-src 'self'` blocks the CDN language-data fetch). Caught by
  actually running the real upload→OCR flow through real Chromium
  (Playwright), not by reading code — the console showed the literal CSP
  violation. **Fix: self-hosted the worker/core/lang assets** under
  `public/tesseract-assets/` (~9.6MB, committed, README in that directory)
  and wired `workerPath`/`corePath`/`langPath`/`workerBlobURL: false` in
  `src/modules/a4-estimates/ocr.client.ts:31-56`. `middleware.ts` itself
  was never touched (W3's file, not mine). Full ADR "Consequences" section
  documents the tradeoff (only the SIMD+LSTM core variant is hosted, not a
  non-SIMD fallback).

- **`src/modules/a4-estimates/`** (module code, mirrors
  `src/modules/a1-letters/`'s shape: `types.ts` / `parser.ts` (pure) /
  `queries.ts` / `actions.ts` / `index.ts`, plus two client-only files):
  - `types.ts` — full type surface for `ExtractedJson`/`CandidateLineItem`/
    `CandidateTotal`/`EstimateVersionSummary`/etc., all traced to the
    migration's real columns. Documents the one real design decision not
    given literally by the task: multi-page storage. `storage_key` (a
    single `text` column) stores `JSON.stringify(string[])` of per-page
    content-addressed paths; `sha256` (a single `char(64)`) stores a
    combined document-level hash (`sha256` of the per-page hashes joined
    with `,`, in page order — `parser.ts:254`'s
    `combinedDocumentHashInput`). A single-page upload is a one-element
    array — one code path, not a special case.
  - `parser.ts` — every spec §8 failure-mode mitigation lives here, pure,
    zero I/O, unit-tested with zero browser dependency (33 tests,
    `test/unit/modules/a4/parser.test.ts`).
  - `queries.ts` / `actions.ts` — `withTenant`-scoped (RLS-enforced) reads
    and writes, same pattern every other module/core family uses.
    `createEstimateVersion` (actions.ts:59) re-verifies sha256 against
    actual bytes, re-verifies a real JPEG signature and an 8MB/page size
    cap (see "Security hardening" below), and does version chaining.
    `confirmEstimate` (actions.ts:139) is the ONLY code path that ever
    writes `confirmed_*` — server-side re-checks `scope_reviewed` and a
    positive `confirmed_total`, never trusting the client's UI gating
    alone.
  - `ocr.client.ts` / `image.client.ts` — `"use client"` files. OCR
    (`runOcrOnPages`) and image downscale+hash (`processEstimatePage`,
    which reuses `src/core/capture`'s `processPhoto`/`sha256Hex` through
    its `index.ts` entry point — legal per `eslint-plugin-boundaries`'
    "modules may reach core only through its index.ts" rule, and avoids
    re-implementing the canvas/hash pipeline a second time).
  - `index.ts` — the module's boundary entry point. **Important lint/build
    finding**: client components must import `ocr.client`/`image.client`
    DIRECTLY (`@/modules/a4-estimates/ocr.client`), not through this
    barrel — the barrel also re-exports `actions.ts`/`queries.ts`, which
    import `pg` via `@/shared/db`, and `next build` genuinely fails
    ("Module not found: fs/dns/net/tls") if a client component pulls that
    in transitively. `eslint-plugin-boundaries`' "modules" policy for `app`
    has no `fileInternalPath` restriction (unlike the "core" policy, which
    is index.ts-only), so importing the specific submodule file directly
    is legal and lint-clean — see `app/estimates/[clientId]/new/EstimateUploadFlow.tsx:1-13`
    and `.../ConfirmEstimateForm.tsx:1-14` for the documented fix.

- **`app/estimates/`** (UI, `docs/design/tokens.css`-only, no rounded-full,
  no sliders, no inline `style={{}}` — the one place that needed a
  dynamically-positioned highlight overlay uses an inline SVG `<rect>`
  with `x`/`y`/`width`/`height` as real SVG attributes, not a CSS `style`
  prop, specifically to stay inline-style-clean; the one dynamic
  progress-bar width uses a native `<progress>` element + `accent-color`
  token, not `style={{width}}`):
  - `page.tsx` + `EstimatesSearch.tsx` — this module's own entry point
    (debounced address search over completed assessments). **Not linked
    from `app/determination/`** (out of this task's assigned directory) —
    see "Integration point" below.
  - `[clientId]/page.tsx` — version-chain list: confirmed totals,
    "OCR-assisted, human-confirmed" vs "Manual entry" provenance badges,
    document thumbnails, sanity-bound warning, and explicit reference-data
    copy ("value/cost overrides in the determination flow remain the
    mechanism of record").
  - `[clientId]/new/` — upload + client-side OCR step
    (`EstimateUploadFlow.tsx`): multi-page selection, "Read text
    automatically and continue" vs "Skip automatic text reading" (manual
    fallback always available, spec's closing paragraph), real progress
    UI, then an immediate upload (so the document is durably attached even
    if the assessor abandons before confirming) before redirecting to the
    confirm screen.
  - `[clientId]/confirm/[estimateId]/` — THE confirmation UI, spec §8's
    heart (`ConfirmEstimateForm.tsx`, ~470 lines). Side-by-side document
    image + SVG highlight overlay per focused row; radio-selected total
    (never auto-picked); per-line-item include + individually-labeled
    "Mark verified: <description>" checkboxes; live reconciliation banner
    with a mandatory extra acknowledgment checkbox on mismatch; live
    sanity-bound banner (>3x `structures.improvement_value`) with its own
    mandatory acknowledgment checkbox; mandatory
    "reviewed for disaster-related scope only" checkbox; a full manual-entry
    fallback (free-text total + repeatable line items) always reachable,
    and forced automatically when OCR found no candidates at all.

- **`app/api/estimates/`**:
  - `[clientId]/upload/route.ts` — role-guarded (assessor/official/admin),
    rate-limited (10/min per user), `Content-Length`-capped, zod-validated,
    delegates to `createEstimateVersion`.
  - `document/[estimateId]/confirm/route.ts` — role-guarded, rate-limited
    (20/min), delegates to `confirmEstimate`.
  - `document/[estimateId]/image/[pageIndex]/route.ts` — serves one page's
    bytes, same pattern as `app/api/photos/[id]/route.ts`.
  - `search/route.ts` — backs the module's own entry-point search.

- **Security hardening (coordinated with W3's concurrent security-review
  pass, `docs/security-review.md`)**: the audit flagged
  `app/api/estimates/**` as lacking the magic-byte sniff / size cap
  `app/api/capture/sync/route.ts` already had. Verified the claim against
  the real commit (`git show 7787982`) and real files
  (`src/shared/security/{rate-limit,upload-validation}.ts`) before acting
  on it — closed the gap using the SAME shared utilities the sync route
  uses (`MAX_PHOTO_BYTES`, `sniffImageType`, `checkRateLimit`), not a
  duplicate: `src/modules/a4-estimates/actions.ts:65-79`,
  `app/api/estimates/[clientId]/upload/route.ts`,
  `app/api/estimates/document/[estimateId]/confirm/route.ts`. Two new
  regression tests assert real rejections:
  `test/unit/modules/a4/estimates-integration.test.ts` "rejects a page
  whose bytes are not a real JPEG..." and "rejects a page that exceeds the
  per-photo size cap...".

- **`test/fixtures/estimates/`** — 3 synthetic invoice images, generated
  (not photographed/downloaded) via `generate-fixtures.mjs` (Playwright
  screenshot of plain HTML, `deviceScaleFactor: 2`), committed as PNGs.
  Contractor name **"TEST CONTRACTING FIXTURE LLC"**, address
  **"000 Fixture Way, Testville, IN 00000"**, and an in-image
  "SYNTHETIC DOCUMENT, NOT A REAL CONTRACTOR" line — screams fake. README
  in that directory documents purpose per fixture (clean/reconciling,
  deliberately-mismatched, deliberately->3x sanity bound).

- **Tests**:
  - `test/unit/modules/a4/parser.test.ts` — 33 tests, pure, no DB. THE
    spec-mandated case (`parseMoneyToDollars("$12,500.00")` → `12500`,
    never `1250000`) plus reconciliation math, sanity bound, keyword
    classification, and two regression tests for real OCR-garble edge
    cases found in this session (see "Real bugs found" below).
  - `test/unit/modules/a4/estimates-integration.test.ts` — 18 tests, real
    `riverline_test` Postgres, no mocks: hash re-verification, magic-byte
    sniff, size cap, version chaining (`supersedes_estimate_id`),
    multi-page storage, tenant isolation (RLS) on both upload and confirm,
    server-side re-validation of `scope_reviewed`/`confirmed_total`,
    re-confirm rejection, audit_log row, sanity-flag propagation, and the
    exact role-gate function the routes call (same pattern
    `test/unit/modules/a3/export-integration.test.ts` established, with
    the same documented reason no route-handler-level test exists —
    `cookies()`/`next/headers` need a real request context this codebase
    has no precedent for unit-testing directly).
  - `test/e2e/a4-estimates.spec.ts` + dedicated
    `test/unit/modules/a4/playwright.a4-estimates.config.ts` (port 3600,
    same containment pattern `test/unit/modules/a2/playwright.a2-dashboard.config.ts`
    already established — no edit to the shared root `playwright.config.ts`).
    4 tests, real Chromium, real client-side tesseract.js OCR, real
    Postgres: full flow (upload → OCR → tap total → verify every line item
    → scope checkbox → confirm → DB-asserted `confirmed_total`/
    `scope_reviewed`/`confirmed_by_user_id`/provenance), explicit
    confirm-disabled-until-verified assertions at every intermediate step,
    manual-entry fallback (new version, `extracted_json IS NULL`),
    reconciliation-mismatch acknowledgment gate, sanity-bound
    acknowledgment gate.

## OCR accuracy observed on fixtures

Ran real tesseract.js (Node worker, standalone check) against all 3
committed fixtures. **First pass (1x screenshot resolution): 9/10 dollar
amounts read correctly; one line item's amount ("$4,500.00" →
"sas0000") badly garbled — but the 4 TOTAL-labeled lines (the figure spec
§8's "≥95% accuracy... on totals" bar is actually about) were 100%
correct across all 3 fixtures.** Regenerated fixtures at
`deviceScaleFactor: 2` (same technique as a retina screenshot) —
**second pass: 10/10 amounts correct, including totals, across all 3
fixtures**, confirmed again through the real browser e2e run. Per spec
§8's own framing ("if OCR accuracy... is below roughly 95% on totals, ship
A4 as structured manual entry... and let OCR wait"), this clears the bar
for shipping OCR-assisted intake, not manual-entry-only — but the
one real observed garble was not thrown away as a fluke: it directly
produced two permanent hardening changes (see below), because a
plausible-but-wrong reading is exactly the failure mode spec §8.1 exists
to catch, whether or not the *aggregate* accuracy number clears 95%.

## How each §8 failure mode is mitigated (file:line)

1. **Hallucinated digits.** Crop/highlight overlay:
   `ConfirmEstimateForm.tsx`'s inline SVG `<rect>` (lines ~230-247), driven
   by `focusRow()` (line 78) on hover/focus of any candidate row. Confirm
   disabled until every included line item is individually verified:
   `ConfirmEstimateForm.tsx:105-106` (`includedItems`/`allIncludedVerified`)
   and the gate itself, `:136-141` (`ocrGateOk`, see "Real bugs found" for
   the vacuous-truth bug caught and fixed here). Reconciliation check:
   `parser.ts:200-213` (`reconcileLineItemsAgainstTotal`), rendered live at
   `ConfirmEstimateForm.tsx:349-370`, mismatch requires its own
   acknowledgment checkbox before confirm (`:139` `mismatchGateOk`).
2. **Wrong-number selection.** `parser.ts:136-176`
   (`parseLineItemsAndTotals`) extracts the FULL line-item table plus every
   candidate total-keyword line — never one number. The human taps a radio
   button (`ConfirmEstimateForm.tsx:257-278`); no code path anywhere
   auto-selects `selectedTotalId`.
3. **Multi-page/revision confusion.** `actions.ts:59-123`
   (`createEstimateVersion`): every upload is a new row, `version =
   previous + 1`, `supersedes_estimate_id` linking back — never an update,
   never a merge. Proven by
   `estimates-integration.test.ts`'s "re-uploading... creates a new
   version..." test (asserts the OLD row is byte-for-byte untouched) and
   `a4-estimates.spec.ts`'s manual-entry test (asserts `version: 2`).
4. **Field conditions.** Reuses `src/core/capture/photo.ts`'s
   downscale-before-store pipeline via `image.client.ts:1-30`
   (`processEstimatePage`); OCR itself now runs against the ORIGINAL
   selected file, not the downscaled/recompressed copy, per a real
   accuracy regression found and fixed in this session (see below). The
   parser separately tolerates common OCR digit/letter confusables
   (`parser.ts:90-101`, `[0-9OoIl]`) while never fabricating a value from
   them (`parseMoneyToDollars` stays strict).
5. **Scope mismatch.** Mandatory checkbox, `ConfirmEstimateForm.tsx:438-447`
   ("This estimate has been reviewed for disaster-related scope only...");
   enforced again server-side, not just client-side gating:
   `actions.ts:145-147` (`confirmEstimate` returns
   `scope_not_reviewed` if false) — proven by
   `estimates-integration.test.ts`'s "rejects confirmation when
   scope_reviewed is false" test, which calls the action directly,
   bypassing the UI entirely.
6. **Unit/currency artifacts.** `parser.ts:34-67`
   (`parseMoneyToDollars`) — THE literal spec test case
   (`parser.test.ts` "THE exact spec-mandated case"). Sanity bound:
   `parser.ts:237-246` (`checkSanityBound`, `>3x improvement_value`),
   rendered as a hard warning + its own mandatory acknowledgment
   (`ConfirmEstimateForm.tsx:390-406`).

## Real bugs this task's own tests/browser runs caught (not invented around)

1. **`riverline_app` had no grant on the new `estimates` table** —
   `migrations/0003_app_role.sql`'s wildcard grant is a snapshot, doesn't
   cover tables created later. Caught by the FIRST integration test run
   (`permission denied for table estimates`). Fixed in the migration file
   + applied out-of-band to already-migrated databases.
2. **SQL string-surgery bug in `getEstimateDetail`** — appending
   `, s.improvement_value as improvement_value` onto `ESTIMATE_SELECT`
   via `.replace()` landed the extra column AFTER the `FROM`/`JOIN`
   clauses, not in the `SELECT` list (`relation "s.improvement_value"
   does not exist`). Fixed by writing the query explicitly instead of
   string-splicing (`queries.ts:174-186`).
3. **CSP `worker-src`/`connect-src` fully blocked the OCR worker** — see
   ADR 0007's "Real blocker found" section. Caught only by running the
   real flow through real Chromium, not by reading code. Fixed by
   self-hosting (`public/tesseract-assets/`,
   `ocr.client.ts:31-56`).
4. **Temporal-dead-zone `ReferenceError`**: `let currentPageIndex = 0`
   was declared textually AFTER `await createWorker(...)`, but the
   `logger` callback closure can fire while that `await` is still
   pending. Real `pageerror` caught via a real browser run
   (`Cannot access 'currentPageIndex' before initialization`). Fixed by
   moving the declaration above the call (`ocr.client.ts:29-35`).
5. **Vacuous-truth gating bug**: `includedItems.every(...)` on an EMPTY
   array is `true` in JS — before any line item was included, the
   OCR-path confirm gate was already satisfied the instant a total was
   tapped. Caught by the e2e spec's own explicit
   "confirm-disabled-until-verified" assertions (`toBeDisabled()`
   immediately after tapping the total, before including any item).
   Fixed at `ConfirmEstimateForm.tsx:136` (`ocrGateOk` now also requires
   `includedItems.length > 0` whenever real candidates exist).
6. **Real OCR garble on the fixture itself**: at 1x screenshot resolution,
   tesseract mangled "$4,500.00" into unrelated trailing digits
   ("sas0000") on one line. Two permanent fixes, not a one-off: (a)
   regenerated fixtures at `deviceScaleFactor: 2` (measurably better OCR
   accuracy — see "OCR accuracy" above); (b) `parser.ts:113-124` now
   rejects any trailing digit-run with no `$`/`,`/`.` marker at all,
   because a bare short digit run is far more likely to be OCR noise than
   a real line-item amount in this domain — regression test:
   `parser.test.ts` "rejects a bare trailing digit run with no currency
   marker at all".
7. **Playwright locator ambiguity**: `getByRole("radio", { name: "Total
   $12,500.00" })` without `exact: true` substring-matched BOTH "Total
   $12,500.00" and "Subtotal $12,500.00" (the clean fixture has both a
   Subtotal and a Total line, both total-keyword candidates by design).
   Fixed with `exact: true` on all three total-radio locators in the spec.
8. **Windows dev-server `PageNotFoundError`** for a freshly-created
   `[clientId]` dynamic route folder — this environment's own documented
   `.next` readlink/stale-manifest gotcha (see task's own ENVIRONMENT
   note). Fixed by deleting `.next` and restarting; not a code bug.

## Deviations from a literal reading of the task

- **Multi-page storage encoding** (`storage_key` as a JSON array,
  `sha256` as a combined hash) — the literal migration columns are
  singular `text`/`char(64)`; documented in `types.ts`'s "Multi-page
  documents" doc comment and the migration's own header, same spirit as
  ADR 0006's documented `pdf_storage_key`-stores-HTML precedent.
- **This module's own entry point** (`app/estimates/page.tsx`, address
  search) exists because nothing in `app/determination/` (out of this
  task's assigned directory) links here yet. **Integration point for a
  follow-up, noted per task instructions**: the natural place is a
  "Contractor estimates" link/section on `app/determination/[clientId]/page.tsx`'s
  review screen, next to the photos panel — not built here, `app/determination/`
  is not my module directory.
- **OCR self-hosted, not CDN-fetched** — see ADR 0007 and "Real bugs
  found" #3 above. A real, load-bearing deviation from the ADR's original
  "verified non-blocking" draft, corrected once the real blocker was
  found.
- **`public/tesseract-assets/`** — not explicitly named in "YOUR PATHS,"
  but required for the OCR feature to function at all under the CSP
  another concurrent agent (W3) shipped mid-flight; a new, clearly-scoped,
  additive subdirectory, touching no file another agent owns.
  `middleware.ts` itself (W3's file) was never edited.
- **Security hardening** (magic-byte sniff, size cap, rate limiting on
  `app/api/estimates/**`) — added mid-task in response to W3's real,
  verified audit finding (`docs/security-review.md`, commit `7787982`),
  reusing `src/shared/security/` (a shared, not module-owned, directory)
  rather than duplicating logic.
- **`test/fixtures/estimates/generate-fixtures.mjs`** committed inside
  `test/fixtures/estimates/` (an explicitly-granted path) rather than
  under `scripts/` (not my directory, W4's territory).

## Acceptance checks — run for real, output below

### `pnpm typecheck`
```
> tsc --noEmit
(no output — 0 errors)
```

### `pnpm exec eslint src/modules/a4-estimates app/estimates app/api/estimates test/unit/modules/a4 test/e2e/a4-estimates.spec.ts`
```
(no output — 0 errors, 0 warnings)
```

### `corepack pnpm exec vitest run` (full root suite, includes this task's 51 new tests)
```
Test Files  32 passed (32)
     Tests  293 passed (293)
```
(32 files pass, including `test/unit/modules/a4/parser.test.ts` — 33
tests — and `test/unit/modules/a4/estimates-integration.test.ts` — 18
tests, 51 total this task added.)

### `pnpm exec playwright test --config=test/unit/modules/a4/playwright.a4-estimates.config.ts` (own e2e, port 3600, real Chromium, real OCR, real Postgres)
```
Running 4 tests using 1 worker

  ✓  1 upload -> OCR extracts a clean fixture -> confirm is gated until verified+total+scope -> confirmed row is asserted via DB (11.3s)
  ✓  2 manual-entry fallback: skipping OCR still attaches the document, and confirms as a new version with manual_entry provenance (6.2s)
  ✓  3 reconciliation mismatch requires an explicit acknowledgment before confirm is enabled (spec §8.1) (8.2s)
  ✓  4 sanity bound (>3x improvement value) requires an explicit acknowledgment before confirm is enabled (spec §8.6) (7.5s)

  4 passed (34.3s)
```

### `next build` (production build, catches RSC/client-boundary bundling issues)
```
✓ Compiled successfully
✓ Generating static pages (22/22)
```
All `app/estimates/**` and `app/api/estimates/**` routes listed in the
route manifest, reasonable bundle sizes (no tesseract.js weight baked into
any page's First Load JS — confirmed dynamic-import-only).

### `pnpm exec playwright test --project=chromium` (root suite, shared webServer on port 3000, proves other suites stayed green)
```
[exited with code 0]
```
Ran to completion, `0` exit code (Playwright's CLI exits non-zero on any
test failure) — this task's own `a4-estimates.spec.ts` is picked up by the
shared config too (no `testIgnore` edit to the root `playwright.config.ts`
was needed or made — see "Deviations" above), so this run also proves the
4 A4 tests pass under the shared webServer/port-3000 configuration, not
just the dedicated port-3600 one. Per the orchestrator's own instruction,
the full integrated cross-agent sweep on the settled tree is run by the
orchestrator after commit, not repeated here — this run's purpose was
narrower: confirm this task's own change didn't regress the other,
pre-existing root e2e specs, which it didn't (real exit code, not
inferred).

## What is open / not done in this task

- **Integration link from `app/determination/`** — noted above, not built
  (out of module directory).
- **Non-SIMD core fallback not self-hosted** — `public/tesseract-assets/`
  only hosts the SIMD+LSTM variant; a genuinely non-SIMD-capable browser
  would fail OCR (falls back to the always-available manual-entry path,
  never a hard failure of the page itself, but OCR specifically would not
  run). Documented in ADR 0007.
- **`docs/security-review.md`'s CSP audit predates this module's OCR
  worker need** — the self-hosting fix here closes the gap without
  touching `middleware.ts`, but a future CSP change (e.g. any additional
  `worker-src`/`connect-src` entries) should double-check it doesn't
  reintroduce this exact class of failure for `/estimates/**`.
- Everything else T-W2 asks for (migration, ADR, upload/OCR/confirm flow,
  version chain, provenance labels, fixtures, unit/integration/e2e tests)
  is built and passing per the acceptance checks above.

## Task checklist

Every numbered item in the task brief's BUILD section (1-8) and the
PASS/FAIL table in the final report cover the acceptance checks above.
