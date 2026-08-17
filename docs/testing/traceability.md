# Traceability Matrix

Build-spec requirement → task (`specs/core/tasks.md`) → automated gate
(`pnpm` script / spec file) → live-test procedure (`docs/testing/live-test-plan.md`).

**State of the repo as of 2026-08-17 (verified by reading the tree directly,
not assumed):** `src/core/*` and `src/modules/` are empty scaffold
directories (`.gitkeep` only). `test/e2e/smoke.spec.ts` and
`test/unit/smoke.test.ts` only prove the toolchain runs — zero product
behavior asserted. `scripts/test-offline.mjs` **intentionally fails** with an
explicit "not yet implemented" message (its own header comment says so).
`docs/BLOCKERS.md` B1/B2/B3 are open. Given that, most rows below are
honestly **NO COVERAGE** — this matrix is a target to build against as each
task lands, not a claim that coverage exists today. Re-run this audit at
each task's completion and update the "Automated gate" column with the real
spec file name.

| Build-spec requirement | Task | Automated gate (today) | Live-test procedure | Status |
|---|---|---|---|---|
| M0 auth: magic-link, jurisdiction-scoped sessions, RLS | T-C1 | `pnpm db:migrate && pnpm test:unit --run` (cross-tenant test named in T-C1 acceptance) — **not written yet** | LT-6 (cross-tenant denial) | **NO COVERAGE** — task not started; acceptance check named but no spec file exists under `test/unit/` or `test/e2e/` beyond the smoke test |
| M0 auth: session expiry at 12h (build spec §7.1) | T-C1 | none named | none written in this plan — gap | **NO COVERAGE** (not in live-test-plan.md either; flagged here as a gap in the plan itself, see journal) |
| M1 structure registry: real parcel ingest, address search | T-C2 | e2e spec named in T-C2 acceptance ("e2e spec finds a real address") — **not written yet** | LT-1 (address search step) | **NO COVERAGE** |
| M2 capture: 12/7-element flow, photo capture, autosave, offline queue, sync | T-C3 | `pnpm test:offline` — **currently fails by design**, explicit placeholder | LT-1, OT-1, OT-2, OT-3, OT-5, DI-4 | **NO COVERAGE** — this is the single most consequential gap: the build's own merge-blocker gate for the core offline requirement (AGENTS.md "Offline is a requirement, not a feature") is not implemented |
| M2 capture: two-device conflict resolution, last-write-wins per field + audit | T-C3 (implied by build spec §2.5; not explicit in T-C3's task text) | none named | OT-4 | **NO COVERAGE**, and worth flagging separately: T-C3's task block in `specs/core/tasks.md` does not explicitly list conflict-resolution testing in its acceptance criterion, only "queue + idempotent sync" — the per-field-conflict behavior described in build spec §2.5 has no task-level acceptance hook at all yet. This is a gap in the task spec, not just in test coverage. |
| M3 engine: deterministic calc, golden fixtures, cost-table version stamp | T-C4 | `pnpm test:unit --run` against `test/fixtures/engine/cases.json` (orchestrator-authored fixtures exist) | LT-2 | **PARTIAL** — fixtures exist (`test/fixtures/engine/cases.json`, `cost-table.test-fixture-v0.json`) but `src/core/engine/` has no implementation yet (`.gitkeep` only), so the fixtures currently have nothing to run against |
| M3 engine: no-cost-table-loaded explicit state | T-C4 / `specs/constitution.md` §2 | none named | LT-2b | **NO COVERAGE** |
| M4 determination: review queue borderline-first, override+reason audited, explicit adopt, never auto-adopt | T-C5 | e2e spec named in T-C5 acceptance ("assessor completes capture → official overrides... → adopts → audit_log rows asserted") — **not written yet** | LT-3 | **NO COVERAGE** |
| M4 determination: supersede flow, never delete | T-C5 / AGENTS.md rule 11 | none named | DI-2 | **NO COVERAGE** |
| `calculations` immutable — insert-only, never UPDATE | AGENTS.md rule 10 (cross-cutting, no single task owns it explicitly) | none named | DI-1, DI-3 | **NO COVERAGE** — and notably no task in `specs/core/tasks.md` names this as an explicit acceptance check anywhere; it is a cross-cutting rule with no task-level test hook |
| A1 letters: refuse when ordinance_citation null | T-A1 | none named | LT-4 | **NO COVERAGE** — but this is the highest-priority gate to write first: it is currently *true by construction* (B2 is unresolved, so the citation actually is null in every real environment right now), so this is the cheapest, highest-signal automated test available today — no fixture gymnastics required, the blocked state already exists |
| A1 letters: correct citation, appeal language, ICC instructions, print legibility | T-A1 | none named, and cannot exist until B2 (`docs/BLOCKERS.md`) is resolved | LT-4b | **BLOCKED on B2**, not just uncovered |
| A2 dashboard: caseload counts, CSV export, status color+label | T-A2 | none named | LT-5 | **NO COVERAGE** |
| A3 SDE export: structure matches verified 12/7-element set | T-A3 | none named | LT-5, LT-5b | **NO COVERAGE**; LT-5b additionally **BLOCKED** — no agent has installed/evaluated the FEMA SDE 3.0 desktop tool per `docs/data-contracts/sde-cost-tables.md` |
| Backup/restore tested before pilot | build spec §7.5 | none named — no task in `specs/core/tasks.md` owns this at all | LT-6 (restore leg) | **NO COVERAGE**, and again a gap in the task list itself: no T-C/T-A task's acceptance criterion mentions backup/restore |
| Tap target ≥48px, ≥8px spacing | `direction.md`, `ui-review-checklist.md` | `scripts/check-contrast.mjs` covers contrast only, **not target size** — no automated box-model check exists | FC-1 | **NO COVERAGE** for size specifically (contrast has a script; size does not) |
| Contrast ≥4.5:1 / ≥3:1 | `direction.md`, tokens.css | `node scripts/check-contrast.mjs` — **exists and appears functional** (verified by reading the script; token pairings and thresholds documented inline) | FC-2 | **COVERED** (design-token level) — but only for the *token* pairings enumerated in the script, not for every ad hoc color usage in actual rendered components, since no `src/` UI exists yet to check |
| No slider for numeric input | `ui-review-checklist.md` Part A | none named — would need a grep-based lint rule or a Playwright DOM query | FC-4 | **NO COVERAGE** |
| Onboarding ≤10 minutes, demo structure | build spec §6.7 | none named | FC-7 | **NO COVERAGE** |
| Photo SHA-256 hashing, EXIF strip-on-serve split | build spec §3, §7.4 | none named | DI-4 | **NO COVERAGE** |
| Cross-tenant RLS proven at DB layer | build spec §7.2 | T-C1 acceptance names it explicitly — **not written yet** | LT-6 | **NO COVERAGE** (named in the task, not yet implemented) |
| Sync endpoint idempotent via `assessments.client_id` | `specs/constitution.md` §5 | none named | OT-5 | **NO COVERAGE** |
| iOS no-Background-Sync design (foreground/visibility-triggered sync only) | ADR 0002 | none named | OT-3, LT-2 | **NO COVERAGE** as a test, though the ADR itself documents the constraint clearly for implementers |

## Summary of the 3 most important gaps

1. **`pnpm test:offline` — the project's own designated merge-blocker for
   the core offline requirement — is a stub that fails on purpose.** Every
   procedure touching M2 (LT-1, OT-1/2/3/5, DI-4) currently has zero
   automated coverage as a direct consequence. This is not a hidden gap; the
   script says so in its own source, but it is worth stating plainly here
   because it blocks the single requirement AGENTS.md calls out by name
   ("Offline is a requirement, not a feature").
2. **`calculations` immutability (AGENTS.md rule 10) and the backup/restore
   requirement (build spec §7.5) have no owning task in `specs/core/tasks.md`
   at all** — not "not yet implemented," but literally not named as an
   acceptance criterion anywhere in the task chain. Both are cross-cutting
   legal/data-integrity properties (a contested determination's defensibility
   depends on rule 10; pilot-readiness depends on §7.5), so they risk falling
   through every individual task's acceptance check unless someone adds them
   explicitly.
3. **A1's refusal state (LT-4) is the cheapest, most valuable test to write
   right now and nothing currently exercises it.** Unlike almost every other
   row in this table, LT-4 does not need fixtures or a demo structure to be
   meaningful today — `jurisdictions.ordinance_citation` is null in every
   real environment right now (B2 unresolved), so a Playwright spec
   asserting "letter generation refuses with the B2 message" can be written
   and made to pass as soon as T-A1 exists, with zero dependency on B1/B2/B3
   being resolved first.
