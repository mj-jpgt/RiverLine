# specs/constitution.md

Inherited constraints for every spec and task. AGENTS.md is the full rulebook;
this file only adds build-phase decisions made by the orchestrator 2026-08-17.

1. `schema/core.sql` is frozen as of 2026-08-17. Migrations reproduce it exactly.
2. **No fabricated domain data, ever.** The two known data gaps are modeled as
   explicit runtime states, not filled in:
   - `jurisdictions.ordinance_citation` is null until a human enters the real
     text. Letter generation (A1) must refuse with a visible "ordinance
     citation missing — see docs/BLOCKERS.md B2" state. Never a placeholder
     string, never lorem, never a generated citation.
   - `cost_tables` has no production seed. The engine (M3) takes a cost table
     as input; if none is loaded for the jurisdiction, the capture flow
     completes and stores the assessment, and the calculation screen shows an
     explicit "no cost table loaded — see docs/BLOCKERS.md B1" state.
     Test-only tables live in `test/fixtures/cost-tables/`, are labeled
     `source_citation: 'TEST-FIXTURE — arbitrary values for math verification
     only'`, and seed only `*_test` databases.
3. Element codes are the verified SDE 3.0 set (12 residential, 7 non-residential)
   from `docs/data-contracts/sde-cost-tables.md`. The build spec §4.3's 8-item
   list is corrected and must not be used.
4. Occupancy branch (residential vs non-residential) derives from parcel
   `PROPCLASS` per `docs/data-contracts/dlgf-property-classes.md`, overridable
   by the assessor in the field.
5. iOS has no Background Sync (ADR 0002). Sync triggers: app open/visibility,
   `online` event, manual retry button. Sync endpoint is idempotent via
   `assessments.client_id`.
6. Auth for MVP build: email magic-link, allowlist, no self-signup (spec §2.6).
   Local dev uses a mailbox-less dev transport that logs the link server-side —
   clearly gated to non-production env, never a bypass in production code paths.
7. Every agent session appends to `docs/journal/<date>-<module>.md`:
   what was done, what was verified (command + result), what is broken/open.
8. Definition of done per task = its acceptance check command passing, run for
   real, output quoted in the journal entry.
