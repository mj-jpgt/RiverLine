# 2026-08-18 — G4: pragmatic intelligence (triage scoring, review flags, exposure rollup)

## What was done

1. **Research first, verdict recorded before any code:**
   `docs/data-contracts/depth-damage-review.md`. Read USACE EGM 04-01
   (Generic Depth-Damage Relationships, primary source, page-by-page —
   Tables 1-3, p.6-8) directly rather than trusting a first indirect
   WebFetch summary, which turned out to be wrong (it claimed
   "component-level" damage percentages from a garbled read of the PDF's
   compressed byte streams; reading the actual pages showed EGM 04-01 gives
   only a single whole-structure percent-damage-by-depth curve per
   structure type, no per-element breakdown anywhere). Cross-checked against
   FEMA's BCA Toolkit DDF description and against the already-on-file SDE
   3.0 tool inspection (`docs/data-contracts/sde-tool-inspection.md`), which
   independently confirms `damage_pct` has no depth-derived default anywhere
   in the shipped FEMA tool — it is a field-observed value per element, by
   design. **Verdict: no per-element damage suggester was built.** Building
   one would have required inventing an allocation methodology no source
   supports — exactly the "fabricated constants" failure
   `docs/agents/ORCHESTRATOR.md` calls the most dangerous one in this
   project.
2. **`src/core/intelligence/`** (new core family): `types.ts`, `pure.ts`
   (zero I/O, unit-tested), `queries.ts` (tenant-scoped, `withTenant`),
   `index.ts` (public entry point per `docs/adr/0003`).
3. **Triage score** — `computeTriageScore` (`src/core/intelligence/pure.ts`):
   ```
   priority = 0.4*closeness + 0.3*valueAtStake + 0.2*waterDepth + 0.1*zoneSeverity
   ```
   - `closeness`: 1.0 at exactly the 50% legal line, linear to 0.0 at 0%/100% away. Null ratio (no calculation) scores 0.
   - `valueAtStake`: `structures.improvement_value` (AVIMPROVE), min-max normalized against every other value currently in the queue being scored — read-time only, never a fixed external constant.
   - `waterDepth`: `assessments.water_depth_interior_in`, same min-max normalization against the current queue.
   - `zoneSeverity`: FEMA SFHA zone tier — V/VE (coastal high-hazard) = 1.0, any A-prefixed zone (1% annual chance inland) = 0.5, X/D/unknown/null = 0. Source: `docs/data-contracts/fema-nfhl.md` and https://www.fema.gov/about/glossary/flood-zones (retrieved 2026-08-18).
   - `sortTriageQueue` keeps the existing BORDERLINE > SD > NOT_SD > no-calculation bucket order (`src/core/determination/pure.ts` `queueBucket`, reused via `@/core/determination`'s index.ts) as the PRIMARY key — untouched — and only uses the score as the secondary, within-bucket tiebreak, replacing the prior "oldest first" tiebreak (which now applies only as the final tiebreak on an exact score tie).
   - The formula, in plain language with the same weights, is shown in the review queue's "Why this order?" `<details>` disclosure (`app/determination/page.tsx`) — never an opaque score.
   - Score is never persisted, never written to `calculations`/`determinations`, and is recomputed fresh on every page load.
4. **Review flags** — `computeReviewFlags` (`src/core/intelligence/pure.ts`), all computed live, read-time only, never persisted, rendered in a new "Flags" card on the review screen (`app/determination/[clientId]/page.tsx`):
   - `missing_photo_for_damaged_element` — one flag per element with `damage_pct > 0` and no photo carrying that `element_code`.
   - `near_band_boundary` — ratio within 2 percentage points of the engine's own 45%/55% BORDERLINE boundaries (`src/core/engine/calculate.ts`'s real constants, not new ones).
   - `borderline_value_not_appraisal` — `thresholdResult === "BORDERLINE"` and `value_source !== "appraisal"`.
   - `gps_far_from_parcel` — the assessment's recorded GPS fix is more than ~150m from the structure's stored point (`structures.geom`), via a single `ST_Distance` point comparison (`getGpsDistanceMeters`) — one row, two already-stored points, not a spatial join, so it stays inside AGENTS.md's "serving path reads rows, never a spatial join at request time" rule.
   - `water_depth_no_water_line_damage` / `water_line_damage_no_water_depth` — water depth on file with zero damage on foundation/floor/interior (residential) or foundation/interiors (non-residential), or the reverse.
   - Flags never disable or hide `AdoptAction` — they render, the official decides (AGENTS.md rule 12).
5. **Exposure rollup** — `getExposureRollup` (`src/core/intelligence/queries.ts`): sum of `calculations.total_repair_cost` (latest calculation per structure) across every structure whose latest determination is absent or still `draft`. Rendered as an additive stat row on the review queue page (`app/determination/page.tsx`), **not** on `/dashboard`: `/dashboard` and `src/modules/a2-dashboard` belong to G1/A2 per this session's agent-path assignment, so the rollup was placed on the page this agent does own (the review queue) rather than risk a concurrent-edit conflict on another agent's files. It reads naturally there — a manager looking at what's in the queue sees the money attached to it in the same view.
6. Tests: `test/unit/intelligence/pure.test.ts` (33 unit tests — score components, the exact weighted formula, bucket-preserving sort, and every flag rule, each with a fixture proving both the flagged and not-flagged case). `test/e2e/g4-intelligence.spec.ts` + `test/playwright.g4.config.ts` + `test/run-g4-e2e.mjs` (new dedicated gate, port 4950, `AUTH_RATE_LIMIT_EMAIL`/`AUTH_RATE_LIMIT_IP` relaxed for `riverline_test` only — same pattern as `scripts/test-determination.mjs`, kept under `test/` rather than `scripts/` since `scripts/` isn't this agent's assigned path). Added `"test:g4": "node test/run-g4-e2e.mjs"` to `package.json`.

## What was verified (commands + results)

- `pnpm exec tsc --noEmit` — clean on every file this pass touched (two pre-existing, unrelated errors in `app/api/admin/users/[userId]/{deactivate,reactivate}/route.ts` predate this session and are outside this agent's assigned paths).
- `pnpm exec eslint .` — 0 errors (7 pre-existing warnings elsewhere, unrelated to this pass).
- `pnpm exec vitest run` (full suite) — 439 passed, 5 skipped (pre-existing skips), 0 failed.
- `node test/run-g4-e2e.mjs` (port 4950, riverline_test) — see PASS/FAIL table below.
- `pnpm exec playwright test --config=playwright.determination.config.ts` (the existing determination gate, to prove the "Flags" card addition doesn't break it) — see table below.
- Root chromium suite at `E2E_PORT=3065` — see table below.
- Live probe of the deployed review queue after push — see table below.

| Gate | Result | Notes |
|---|---|---|
| `pnpm exec tsc --noEmit` | PASS | Clean on every file this pass touched. |
| `pnpm exec eslint .` | PASS | 0 errors (module boundaries, no-empty-catch, no-raw-color all clean on this pass's files). |
| `pnpm exec vitest run` (full suite) | PASS | 439 passed, 5 skipped, 0 failed — includes the 33 new `test/unit/intelligence/pure.test.ts` cases. |
| `node test/run-g4-e2e.mjs` / `test/playwright.g4.config.ts` (port 4950) | **FAIL** (environmental, not a code defect — see below) | Failed 3 times across the session, always at a client-side navigation step inside the shared capture flow (`/capture` → next step, or the final "View calculation" click), never inside G4's own code path. |
| `playwright.determination.config.ts` (existing gate, unmodified by this pass, full 13-test suite) | **FAIL** (same signature) | Failed at the *first* capture step of `a1-letters.spec.ts` and `determination.spec.ts` — both files predate this session and were not touched by it. Run as a direct regression check on whether G4's "Flags" card addition broke the existing gate; it did not reach that code at all before failing on an unrelated navigation step. |
| Root chromium (`playwright.alt-port.config.ts`, `E2E_PORT=3065`, `workers=2`) | **PARTIAL** | First pass (env misconfigured — `DATABASE_URL` not exported to the test runner in that shell) failed 6 of 38 on a `DATABASE_URL is not set` pattern; second pass (fixed) ran 35 tests (g4-intelligence.spec.ts correctly excluded once added to `playwright.config.ts`'s `testIgnore`, mirroring the existing determination/a1-letters/admin pattern) and got 16 passed, 12 failed, 7 did not run — failures spanning `security-headers`, `shell`, `registry`, `registry-f1`, `a2-dashboard`, `motion`, `a4-estimates`, `multi-device-sync`, none of which this pass's diffs touch. |
| Live probe after push | see below | |

**Root cause of every e2e failure this session:** this repo has no worktree isolation between concurrently-running agents (`git worktree list` showed only the main checkout for the whole session) — F2, G1, G2, G3, and a copy-sweep agent were all running background work in the same directory tree at the same time (≈18 concurrent `node.exe` processes observed via `Get-Process`). The first symptom was outright `.next/` build-cache corruption (`ENOENT`, `__webpack_modules__[moduleId] is not a function`) when two `next dev` instances wrote to the same shared `.next/` directory at once; that was fixed for this session by running the gates from an isolated `git worktree` (a plain `git worktree add` plus a `node_modules` junction back to the main install, cleaned up after use — not committed). Once the build cache was isolated, a second, milder symptom remained: under the same heavy concurrent CPU/IO load, client-side navigation after a button click intermittently never completed within Playwright's timeout — reproduced identically in `g4-intelligence.spec.ts` (this pass's own new spec), in the pre-existing, untouched `determination.spec.ts` and `a1-letters.spec.ts`, and across a wide, unrelated spread of the root suite. This is evidence the failures are systemic to the shared, heavily-loaded environment, not a defect in this pass's code — per the orchestrator's instruction, retried once cleanly per gate and then documented honestly here rather than looped further.

**What IS verified as actually correct, independent of the flaky e2e layer:** every unit-testable behavior (the exact triage formula, the bucket-preserving sort, and all six flag rules, including both the flagged and not-flagged case for each) passes in `pnpm exec vitest run`, which does not depend on browser navigation at all. `tsc`/`eslint` confirm the wiring into `app/determination/page.tsx` and `app/determination/[clientId]/page.tsx` type-checks and respects module boundaries. The one concrete, non-flaky finding from the e2e attempts was a real gap this pass fixed along the way: `g4-intelligence.spec.ts` needed to join `playwright.config.ts`'s `testIgnore` list (same reason `determination.spec.ts`/`a1-letters.spec.ts`/`admin.spec.ts` are already there) so the root suite doesn't run it against `riverline_dev`, which has no cost table.

## What is still broken / open

- The exposure rollup lives on the review queue page, not `/dashboard`, for the concurrent-edit-safety reason explained above. If G1/A2 want it on the dashboard too, `getExposureRollup` (`src/core/intelligence`) is already the reusable query — wiring a second call site is a small follow-up, not a redesign.
- No per-element damage suggester exists (by design — see the DDF verdict above and `docs/data-contracts/depth-damage-review.md`'s "What a defensible future version would need" section for the concrete path if a jurisdiction ever wants one).
- `structures.sfha_zone` only stores the FLD_ZONE code (not `ZONE_SUBTY`/`SFHA_TF`), so the zone-severity tier cannot distinguish shaded vs. unshaded Zone X — documented as a known limitation in `src/core/intelligence/pure.ts`'s `zoneSeverityTier` doc comment rather than guessed at.
