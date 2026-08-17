# Core build — serialized task chain (one agent at a time, in order)

Status legend: [ ] open · [~] in progress · [x] done (verify command quoted in journal)

### [x] T-C1 Database + M0 auth foundation
**Module:** migrations/, src/core/auth/, src/shared/db/
**May read:** schema/core.sql, docs/adr/*, specs/constitution.md
**Objective:** Real Postgres schema live via migrations; magic-link auth with
jurisdiction-scoped sessions; RLS proven by a failing cross-tenant test.
**Outputs:** migration 0001 (= schema/core.sql), db client that sets
app.jurisdiction_id + app.user_id per request, login/logout, session cookie,
role guard helpers, seed script for a demo jurisdiction ("Demo City" +
"123 Practice Ln" practice structure — constitution §6 note: demo jurisdiction
is a real row, clearly named, not a mock).
**Acceptance:** `pnpm db:migrate && pnpm test:unit --run` green including a
cross-tenant test that INSERTs two jurisdictions and proves tenant A cannot
read tenant B via the app db client; immutability probes (UPDATE/DELETE on
calculations raises; DELETE on determinations raises; determination UPDATE
writes audit_log) — AGENTS.md rules 10/11; `pnpm test:e2e` login spec passes.

### T-C2 M1 structure registry + real parcel ingest
**Module:** scripts/preprocess/, src/core/registry/
**May read:** docs/data-contracts/hamilton-county-parcels.md, fema-nfhl.md,
dlgf-property-classes.md, data/raw/*
**Objective:** Preprocessing script pulls real Hamilton County parcels +
NFHL zones (bounded area is fine), loads structures; registry UI: search by
address, nearest-by-GPS list. No map dependency.
**Acceptance:** script run against live services ingests real parcels
(journal quotes row count); e2e spec finds a real address and opens it.

### T-C3 M2 field capture, offline-first
**Module:** src/core/capture/, src/sw/ (service worker)
**May read:** docs/design/* (mandatory), docs/adr/0002
**Objective:** Element-by-element capture flow (12 res / 7 non-res), photo
capture, autosave-to-IndexedDB per screen, queue + idempotent sync, offline
banner with queue count.
**Acceptance:** `pnpm test:offline` — Playwright runs the full capture flow
with network disabled, then re-enables network and asserts sync. This flips
the currently-failing gate to green.

### T-C4 M3 50%-rule engine (pure TS)
**Module:** src/core/engine/
**May read:** docs/data-contracts/sde-cost-tables.md, test/fixtures/engine/
**Objective:** Deterministic pure functions: (structure, elements, cost_table)
→ per-element costs, total, ratio, threshold_result (NOT_SD <45%, BORDERLINE
45–55%, SD ≥55%; legal threshold stays 50% in all copy). Engine version
stamped. Depreciation per verified Table 3-5.
**Constraint:** golden fixtures in test/fixtures/engine/ are ORCHESTRATOR-
authored. Agent implements to them, may add edge-case tests, may not modify them.
**Acceptance:** `pnpm test:unit --run` — all golden fixtures pass.

### T-C5 M4 determination + adoption workflow
**Module:** src/core/determination/
**May read:** docs/design/*, schema/core.sql
**Objective:** Official review queue (borderline-first), full-input review
screen, element/value override with mandatory reason (audited), explicit
adopt action, supersede flow. Never auto-adopt.
**Acceptance:** e2e spec: assessor completes capture → official overrides one
element with reason → adopts → audit_log rows asserted via db query.

### T-C6 Backup / restore proof (build spec §7.5, §10.6)
**Module:** scripts/ops/
**Objective:** `pnpm db:backup` (pg_dump) and `pnpm db:restore <file>`;
a test that backs up the dev db, restores into a scratch db, and asserts row
counts + a sampled determination survive. Traceability gap flagged
2026-08-17 by test-plan agent — no other task owned this.
**Acceptance:** restore test green in `pnpm test:unit --run`; journal quotes it.

---
# Add-ons (parallel after T-C5; one directory each)

### T-A1 Letters  — src/modules/a1-letters/
Print-first PDF; refuses with explicit state when ordinance_citation is null.
### T-A2 Dashboard — src/modules/a2-dashboard/
Status counts, caseload list, CSV export. Map optional, last.
### T-A3 SDE export — src/modules/a3-sde-export/
Export matching verified 12/7 element structure.
