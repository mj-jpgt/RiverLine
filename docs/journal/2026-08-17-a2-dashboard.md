# 2026-08-17 — T-A2: administrator dashboard + CSV/records export

## What I did

Built the desktop administrator dashboard: status overview (by determination
status AND by calculation band, tenant-scoped), a server-side-paginated
caseload table (sortable/filterable/searchable, whitelisted columns only),
a filtered CSV export, and a full jurisdiction records-request export as a
hand-rolled ZIP of CSVs.

- **`src/modules/a2-dashboard/`** (read-only queries + pure helpers, same
  split as `src/core/determination/`):
  - `types.ts` — `CaseloadRow` (one row per STRUCTURE, not per assessment —
    the task's caseload entity — carrying its latest completed assessment's
    latest calculation and latest determination, all nullable), count
    types, filter/sort types.
  - `pure.ts` — the whitelist layer every untrusted query-string value goes
    through before it can reach SQL: `resolveSort` (only a fixed
    `SORT_COLUMN_SQL` map's 6 keys are reachable; anything else degrades to
    `completed_at desc`), `resolveStatusFilter`/`resolveBandFilter` (enum
    whitelist + `ALL`/`NONE`), `resolveIsoDate` (regex-gated
    `YYYY-MM-DD` only), `resolveSearch`/`resolvePage`/`resolvePageSize`.
    Also `bandLabel`/`determinationStatusLabel` (label text, paired with
    color per direction.md — never color alone).
  - `csv.ts` — hand-rolled RFC 4180 CSV escaping (task forbids a csv
    dependency): `escapeCsvField`, `toCsvRow`, `buildCsv` (CRLF lines,
    Excel-targeted per spec §6.4).
  - `zip.ts` — a minimal, dependency-free ZIP (STORE method) writer: CRC-32
    table implementation + the local-file-header / central-directory /
    end-of-central-directory binary layout, by hand. See "Records-request
    export" below for why this was chosen over "multiple CSV downloads."
  - `queries.ts` — `getDashboardCounts`, `getCaseload` (paginated),
    `getCaseloadForExport` (same filters, unpaginated), `getFullExportTables`
    (every one of the 10 tenant-scoped tables — `jurisdictions`, `users`,
    `structures`, `assessments`, `assessment_elements`, `photos`,
    `calculations`, `determinations`, `letters`, `audit_log` — via
    `withTenant`, relying on RLS itself for jurisdiction scoping rather than
    an app-level WHERE, per `docs/agents/SUBAGENT.md` "Role: data / backend
    agents" #1). One shared CTE (`LATEST_STATE_CTE`) — latest completed
    assessment per structure, its latest calculation, the latest
    determination on any of that assessment's calculations — mirrors the
    lateral-join shape `src/core/determination/queries.ts` already
    established for `getReviewQueue`, generalized from "per assessment" to
    "per structure."
  - `index.ts` — public entry point (module-boundary rule, ADR 0003). No
    other core/module family is imported — this module talks to Postgres
    directly via `withTenant`, same shape as `src/core/registry`.

- **`app/dashboard/`**:
  - `page.tsx` + `page.module.css` — status overview as text-forward stat
    rows (label + color-coded badge dot + tabular-nums count), NOT icon
    cards and NOT left-border-strip cards (`docs/design/components.md`
    §4.2 hard fails); filter buttons (band, determination status) as
    `Link`s with query params, same pattern `app/determination/page.tsx`
    established; a small GET `<form>` for search + date range (button
    groups were used instead of a `<select>` for the ≤6-option band/status
    filters per components.md rule 6); a dense, server-side-paginated
    table (dense tables permitted only in this desktop admin context,
    direction.md → "Layout") with sortable column headers; pagination
    controls. Every filter/sort change is a plain navigation (no client
    JS needed for the table itself) — the whole page works with
    JavaScript off except the two export buttons.
  - `loading.tsx` / `error.tsx` — designed states, same shape as
    `app/determination`'s.
  - `_components/ExportButtons.tsx` — `ExportCsvButton`/`FullExportButton`,
    client components. A plain `<a download>` can't show a loading state
    (the browser gives no signal while the server is generating the file),
    so these `fetch()` the export route, then trigger the save dialog from
    the resulting blob — default/hover/active/loading/error states all
    present, per components.md's dashboard inventory ("CSV export button
    ... default, hover, active/pressed, loading (generating), success/
    error").
  - `export/csv/route.ts` — "Export CSV": the exact column list the task
    names, in that order (`address, parcel_id, ratio, band,
    determination_status, adopted_date, value_used, value_source,
    cost_table_version`), respecting the current filtered view (reads the
    same filter/sort query params the page uses). Role-guarded
    `["admin","official"]`.
  - `export/full/route.ts` — "Full export (records request)": every
    tenant-scoped table as one CSV each, bundled into a real ZIP with a
    `MANIFEST.txt` listing every file and its row count. Role-guarded the
    same way.

## Records-request export: ZIP vs. multiple downloads (decision, per task instructions)

Task instructions: "server generates zip via node's built-in zlib ONLY if
trivially achievable without new deps; otherwise multiple CSV downloads
with a manifest; document choice." I chose a real ZIP. Node's `zlib` module
itself provides compression codecs, not an archive-container writer — there
is no built-in "make me a .zip" call — so I did not end up calling into
`zlib` at all: the ZIP *container format* (local file header + central
directory + end-of-central-directory, all fixed binary layouts) needed only
a CRC-32 implementation, which is a ~20-line lookup-table algorithm with no
library dependency of any kind. Every entry uses the STORE (uncompressed)
method rather than DEFLATE — skips needing `zlib.deflateRawSync` entirely
and any client (Explorer, Archive Utility, 7-Zip) opens it identically. This
was "trivially achievable" in the sense the task meant (no new dependency,
a well-documented fixed format), even though it turned out not to touch
`zlib` itself. Unit-tested (`test/unit/modules/a2/pure.test.ts`): valid
local-file-header/EOCD signatures, correct entry count, CRC-32 stability.
E2E-tested: a real downloaded file starts with the ZIP magic bytes and
contains the expected member names.

## Deviations from the literal `src/modules/a2-dashboard/` + `app/dashboard/` directories

- **Playwright config** for the e2e spec lives at
  `test/unit/modules/a2/playwright.a2-dashboard.config.ts`, not at the repo
  root. This task's coexistence rules restrict me to writing only inside
  `src/modules/a2-dashboard/`, `app/dashboard/`, `test/unit/modules/a2/`,
  the single file `test/e2e/a2-dashboard.spec.ts`, and this journal file —
  the root `playwright.config.ts` is off limits (two other agents run
  concurrently in this same working tree), and that file's own `webServer`
  is hardcoded to port 3000, which I was told never to touch. Placing the
  config inside my writable `test/unit/modules/a2/` directory (with
  `testDir`/`testMatch` pointed at the one e2e spec file) stays inside the
  literal whitelist while giving the suite its own baseURL (port 3200) and
  no `webServer` block — mirrors `playwright.offline.config.ts`'s own
  documented reason for omitting `webServer` (the operator starts/stops the
  server itself).
- **`specs/core/tasks.md`** — one line, `T-A2` marked `[x]`, explicitly
  in scope per this task's own instructions ("T-A2 [x] in
  specs/core/tasks.md (retry on conflict)").
- Did **not** touch `schema/core.sql`, any other module's `src/core/*` or
  `src/modules/*`, `app/determination/`, `app/letters/`,
  `app/a3-sde-export`-adjacent routes, or the root `playwright.config.ts`.

## Isolation from the two concurrent agents (T-A1, T-A3)

Every count/caseload assertion in both the unit DB suite
(`test/unit/modules/a2/queries.test.ts`) and the e2e suite
(`test/e2e/a2-dashboard.spec.ts`) is scoped to a freshly-created, randomly
suffixed jurisdiction created in that suite's own `beforeAll` — never
"Demo City" or any shared fixture. Since every dashboard query is
tenant-scoped through `withTenant` (RLS enforced at the database, not an
app-level filter), rows created by other concurrent agents in a different
jurisdiction are structurally invisible to these queries, not merely
filtered out by a WHERE clause that could be wrong. This is what makes an
*exact* count assertion (`expect(counts.totalStructures).toBe(6)`) safe to
run against a shared `riverline_test` database while other agents are also
writing to it.

## Acceptance checks — run for real, foreground, output below

### `pnpm typecheck` (`tsc --noEmit`)
```
(no output for src/modules/a2-dashboard, app/dashboard, or any test file
this task added — 0 errors)
```
Two pre-existing errors remain in `app/letters/[clientId]/page.tsx`
(T-A1's file, a different concurrent agent's module) — confirmed unrelated
by grepping the output for this task's own paths.

### `pnpm lint` (`eslint .`)
```
C:\...\scripts\check-contrast.mjs
  39:7  warning  'AA_LARGE_TEXT' is assigned a value but never used

✖ 1 problem (0 errors, 1 warning)
```
Same pre-existing warning every prior journal in this repo documents,
outside this task's files. `eslint src/modules/a2-dashboard app/dashboard
test/unit/modules/a2 test/e2e/a2-dashboard.spec.ts` alone: 0 errors, 0
warnings.

### `corepack pnpm exec vitest run test/unit/modules/a2` (isolated unit suite)
```
 Test Files  2 passed (2)
      Tests  36 passed (36)
```
`pure.test.ts` (24 tests, no DB): sort/filter whitelist resistance against
9 SQL-injection-shaped inputs per whitelisted function, CSV escaping (RFC
4180 quoting, null-vs-empty-cell, formula-injection-shaped strings still
just quoted text), ZIP structural validity (signatures, entry count,
CRC-32 stability), page/pageSize bounds. `queries.test.ts` (12 tests, real
`riverline_test` Postgres): exact status/band counts scoped to one
dedicated jurisdiction, one row per structure including a never-assessed
structure, filter composition (band AND status AND search AND date range),
sort correctness, pagination (no overlap between pages), a
TypeScript-bypassing malicious sort value proven harmless at the query
layer (defense in depth beyond `pure.ts`'s own whitelist), cross-tenant
isolation (a second jurisdiction sees zero of the first's rows), and
`getFullExportTables` returning all 10 tables with the expected row counts.

### `pnpm exec playwright test --config=test/unit/modules/a2/playwright.a2-dashboard.config.ts` (own e2e, port 3200)
Server started manually: `DATABASE_URL` pointed at `riverline_test`,
`corepack pnpm exec next dev -p 3200`, waited for a 200 on `/`, ran the
suite, then killed the process and confirmed port 3200 had no LISTENING
socket left afterward.
```
Running 5 tests using 1 worker

  ✓  1 dashboard shows real counts consistent with a direct db query (6.7s)
  ✓  2 filter to BORDERLINE: table rows match db count (2.7s)
  ✓  3 CSV export downloads and parses with a row count and content matching the db (3.3s)
  ✓  4 full export (records request) downloads a real ZIP file (3.1s)
  ✓  5 role guard: an assessor cannot reach the dashboard or its export routes (2.4s)

  5 passed (19.4s)
```
Test 1 asserts the page's "Structures on record" and "Borderline" stat
counts literally equal a direct `select count(*)` the test itself runs
against Postgres. Test 2 filters the live table to BORDERLINE via the real
`Link` control and asserts `<tbody><tr>` count equals a direct DB count,
plus the specific addresses shown/hidden. Test 3 clicks the real "Export
CSV" button, captures the real Playwright `download` event, parses the
downloaded bytes with an independent CSV parser (not the app's own
`csv.ts`), and asserts both the header row and one full data row's values
against a direct DB join — the literal proof point the task instructions
require. Test 4 confirms the full-export button produces bytes starting
with the ZIP magic number and containing the expected member names. Test 5
proves the role guard server-side: an assessor's browser session is
redirected away from `/dashboard`, and a direct `GET
/dashboard/export/csv` request from that same session gets a real `403`,
not just a hidden button.

## What is open / not done in this task

- **No map** (task instructions, point 4): MapLibre GL is not installed;
  adding it needs an ADR per AGENTS.md rule 3, and the spec makes the map
  optional for this add-on. `docs/design/components.md`'s "List/Map view
  toggle" and "Map marker + popup" component-inventory rows are not built.
- **Full export omits photo binaries.** `photos.csv` includes every
  photo's metadata (sha256, captured_at, gps, caption, element_code) but
  not the JPEG bytes themselves — spec §7.6 calls for "every table ... as a
  CSV bundle," which this delivers literally; including the actual image
  files would mean a second artifact type inside the same ZIP (a
  `photos/<id>.jpg` per row) and was left out as a documented scope
  decision rather than attempted partially. If a real records request needs
  photo bytes, ADR + a data-contracts conversation is where that widens
  from a CSV-bundle interpretation to a full-document bundle.
- **CSV export's `getCaseloadForExport` has no upper row cap.** At the
  task-stated 3,821-row scale this is a single in-memory query and fine;
  it would need streaming (or a hard cap + pagination note) at a much
  larger jurisdiction size. Noted, not built, since nothing in the task
  scope suggested that scale exists yet.
- Everything else T-A2 asks for (status overview by both axes, sortable/
  filterable/searchable/paginated caseload table, CSV export matching real
  DB content, records-request export) is built, tested against real
  Postgres, and passing.

## Task checklist

`specs/core/tasks.md` T-A2 marked `[x]` — all acceptance checks above ran
for real, in the foreground, and passed.
