# 2026-08-17 — T-A3: SDE 3.0-structured export

## What I did

Mandatory reading first: `AGENTS.md`, `docs/agents/SUBAGENT.md`,
`specs/constitution.md`, `docs/data-contracts/sde-cost-tables.md` (the
verified 12 residential / 7 non-residential element structure, FEMA P-784
Tables 3-6/3-8), `docs/data-contracts/sde-tool-inspection.md` (static
inspection of the real SDE 3.0 installer's `SDEDatabase.mdb` and
`JSON/*.json` payloads — confirms the tool ships **no dollar-denominated
cost data** and enumerates its actual table/column names where they were
checked), `schema/core.sql` (frozen), and the T-C4/T-C5 journals for the
engine/persistence conventions this module reuses.

**Honesty framing (task instruction 1):** nowhere in this module's code,
API responses, or docs does anything claim the export imports into the real
FEMA SDE desktop tool without re-keying — that is unverifiable here (no
Windows install of the tool was performed for this task). The copy used
throughout is "SDE 3.0-structured export." `docs/data-contracts/sde-export-mapping.md`
has an explicit "IMPORTANT" section stating this, plus a full UNVERIFIED
list.

**Built:**
- `src/modules/a3-sde-export/types.ts` — `ExportAssessmentData` (the flat
  shape every builder consumes), `AssessmentExportJson`,
  `EXPORT_SCHEMA_VERSION = "1.0"`.
- `src/modules/a3-sde-export/csv.ts` — hand-rolled RFC4180-style CSV
  escaping (`csvEscapeField`, `toCsvRow`, `buildCsv`): quotes on comma/quote/
  CR/LF, doubles internal quotes, CRLF line endings, `null`/`undefined` →
  empty field (never the literal string `"null"`). No new dependency.
- `src/modules/a3-sde-export/build-export.ts` — pure builders, zero I/O
  (same discipline as `src/core/engine`): `buildAssessmentExportJson`,
  `buildElementCsv`/`buildElementCsvRows` (one row per assessment-element),
  `buildSummaryCsv`/`buildSummaryCsvRow` (one row per assessment), and
  `buildBatchElementCsv`/`buildBatchSummaryCsv` for the multi-assessment
  batch case.
- `src/modules/a3-sde-export/queries.ts` — tenant-scoped DB fetch via
  `withTenant()` (RLS-enforced), reusing the exact "full verified element
  set, undamaged = 0%, not omitted" recipe `src/core/determination/queries.ts`
  already established, so the two views can never silently drift apart.
  `getExportAssessmentData` (single assessment by `client_id`) and
  `getBatchExportData` (every completed+calculated assessment in the
  jurisdiction). Returns an honest `no_calculation` status rather than a
  partial/fabricated export when no `calculations` row exists yet
  (specs/constitution.md §2).
- `src/modules/a3-sde-export/index.ts` — barrel entry point.
- `app/api/sde-export/[clientId]/route.ts` — `GET`, official/admin only
  (`requireRole(session, ["admin", "official"])`, same gate as
  `app/api/determination/[clientId]/adopt`), tenant-scoped through the query
  layer. `?format=json` (default) or `?format=csv&kind=elements|summary`.
- `app/api/sde-export/batch/route.ts` — `GET`, same role gate, jurisdiction-
  wide CSV (`?kind=elements|summary`).
- `docs/data-contracts/sde-export-mapping.md` — the required field-mapping
  table: our column → SDE 3.0 concept → source → VERIFIED/UNVERIFIED status,
  citing exact quoted field/table names from the inspection doc where they
  exist (e.g. `Default.YearOfConstruction`, `Default.DateOfInspection`,
  `Default.InspectedBy`, `Default.FirmZone`, `Default.FirmPanelNumber`,
  `Default.CostDataRef`/`CostDataDate`, the JSON `Element`/`StoryID`/
  `FoundationID` keys) and marking UNVERIFIED wherever the inspection pass
  never enumerated an exact name (address/parcel/sqft columns in `Property`,
  GPS columns, any water-depth column, any per-element *damage*-percentage
  column, market value/ratio/band columns, `InspectionStatus`/`Attachment`
  table columns). Also includes the "concrete import path a human should
  test with the real tool" section required by task instruction 4: install
  the real tool, use its own UI to key in values (never hand-edit
  `SDEDatabase.mdb` directly), using our export as the checklist.

## Tests (real command output)

Isolated unit suite:
```
$ pnpm vitest run test/unit/modules/a3
 Test Files  3 passed (3)
      Tests  33 passed (33)
```
- `csv.test.ts` — escaping edge cases: plain field, numbers, null/undefined
  → empty (not "null"), comma, embedded double quote (doubled), newline,
  carriage return, and comma+quote+newline combined; row/CSV joining;
  empty-batch header-only CSV.
- `build-export.test.ts` — exact expected JSON for a residential fixture
  (12 elements) and confirms `determination: null` renders honestly for a
  non-residential fixture (7 elements); asserts element counts are exactly
  12 / 7 (specs/constitution.md §3); exact expected CSV header/row content
  for both the element and summary CSVs; comma-escaping in a real field;
  batch CSV concatenation across two assessments and the empty-batch case.
  All dollar figures come from `test/fixtures/engine/cost-table.test-fixture-v0.json`
  (TEST-FIXTURE, cross-checked against the known-good `total_repair_cost:
  39250` figure `test/unit/determination/persist.test.ts` already
  establishes for the same damage recipe) — never invented numbers.
- `export-integration.test.ts` — real Postgres, `riverline_test`, no mocks:
  seeds two jurisdictions, computes real calculations via
  `computeAndPersistCalculation` (T-C4's persistence wiring), then proves
  `getExportAssessmentData`/`getBatchExportData` return the correct
  12-element export for a real assessment, report `no_calculation`/
  `not_found` honestly, and — the tenant-scoping requirement — that
  jurisdiction B's session gets `not_found` (RLS hides the row) for
  jurisdiction A's `client_id`, while jurisdiction A's own session still
  finds it. Also exercises `requireRole` directly (the exact function both
  routes call) with assessor/official/admin/no-session inputs, proving the
  403/401 mapping the routes rely on.

```
$ pnpm typecheck
```
No errors attributable to this module's files (grep confirmed: zero matches
for `modules/a3` or `sde-export` in the output). The only errors present are
pre-existing, in `app/letters/[clientId]/page.tsx` — another agent's
in-progress module, out of my scope per coexistence rules.

```
$ pnpm eslint src/modules/a3-sde-export app/api/sde-export test/unit/modules/a3
```
Zero errors, zero warnings (one harmless "file ignored, no matching config"
warning for the `.md` mapping doc, expected — ESLint doesn't lint Markdown
in this project).

## Deviations / decisions

- **No UI built.** Task instructions explicitly allow this ("a download
  button on an API route is enough... decide and justify"). I decided
  unit + integration suffice: the deliverable is data export for officials/
  admins, both API routes set `Content-Disposition: attachment` so hitting
  the URL directly in a browser already downloads a file — no client code
  is needed to "wire a button." Building a UI page would trigger
  `docs/agents/SUBAGENT.md`'s frontend rules (every interactive control
  needs all states + a Playwright spec clicking the real control), which is
  a real cost for zero functional gain over a plain link; I judged that
  trade not worth it under this task's scope. No `app/sde-export/` UI
  directory was created; no `test/e2e/a3-sde-export.spec.ts` was written.
- **No route-level HTTP integration test.** `cookies()`/`next/headers`
  requires a live request context; grepping the existing test suite found
  no precedent anywhere for importing a `route.ts` handler directly in
  `test/unit`, and standing up the real Next dev server for a Playwright
  round trip risks the 10-minute foreground cap for a single task. Instead
  I integration-tested the two things that actually determine route
  behavior: (1) the tenant-scoped query layer against real Postgres
  (`export-integration.test.ts`), and (2) `requireRole` itself — the exact,
  already-unit-tested function both routes call unmodified — with all four
  role/no-session inputs. This proves the 403/401 mapping without needing
  to fake a Next.js request.
- **Batch CSV route added** (`app/api/sde-export/batch/route.ts`) beyond a
  strict single-assessment reading of the task, to satisfy instruction 2(b)
  ("CSV batch... one row per assessment-element plus a summary CSV") as a
  genuine multi-assessment batch rather than a single assessment's two CSV
  views. The single-assessment route also supports `?format=csv` for both
  kinds, so either reading of "batch" is covered.
- **Element damage_pct has no verified SDE-side field name.** Documented
  explicitly in the mapping doc rather than guessed — the closest candidate
  in the inspected JSON (`ElementPercentage.Percentage`) is a different
  concept (FEMA's default cost-allocation split, not an inspector-recorded
  damage percentage) and was not used as a stand-in.

## What is still broken / open

- Nothing in this module's own scope is known-broken. `app/letters` has
  pre-existing typecheck errors from another concurrent agent's module —
  not touched, not my scope.
- Whether the real SDE 3.0 desktop UI's manual-entry screens accept values
  in the same units RiverLine stores (e.g. inches vs. feet for water depth)
  is unverified — flagged in the mapping doc's "concrete import path"
  section as something a human with the real tool installed should check.
- The `Property` table's exact address/parcel/sqft column names, any GPS
  column name, and the `InspectionStatus`/`Attachment` table's column names
  remain unenumerated in the inspection doc — genuinely unknown, not
  guessed, and listed in the mapping doc's UNVERIFIED summary.
