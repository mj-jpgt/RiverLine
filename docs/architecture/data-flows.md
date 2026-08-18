# Data flows — where RiverLine's data goes, and who it serves

Written by agent V5, 2026-08-18, in response to a direct question from the
project owner: *"consider what the data is being used for — is it going to
the network with other users, or a general data store useful for the rescue
service — look at the big picture in our specs."* This is a decision
document for a human, not marketing copy. It is grounded only in
`docs/riverline-sdd-build-spec.md`, `docs/data-contracts/`, `schema/core.sql`,
and the module code that exists today (verified by reading it, not assumed);
external program facts carry a fetched citation with a retrieval date, per
AGENTS.md rule 4. Where a fact could not be verified, it says so instead of
filling the gap.

---

## 1. Today's flow, structure by structure

RiverLine is single-jurisdiction-scoped end to end. Nothing in the built
system today talks to another jurisdiction, another agency, or the public
internet except the browser serving the app itself. The path one structure's
data actually takes:

```
field capture (M2, offline-capable)
      -> jurisdiction's Postgres rows (structures/assessments/assessment_elements/photos)
      -> calculation engine (M3) -> calculations (immutable, versioned)
      -> official review + adoption (M4) -> determinations
      -> [A1] determination letter (PDF/HTML, printed or handed to the owner)
      -> [A3] SDE 3.0-structured export (CSV/JSON, downloaded by the official)
      -> [A2] full jurisdiction export (ZIP of CSVs, downloaded by the official)
```

Concretely, as built:

- **Capture (M2 / `src/core/capture`)** writes to IndexedDB first, syncs to
  `POST /api/capture/sync` when online. The sync endpoint is idempotent on
  `assessments.client_id` (specs/constitution.md §5). Nothing here talks to
  another jurisdiction — `withTenant()` sets `app.jurisdiction_id` for the
  request and Postgres RLS (`schema/core.sql`, the `do $$ ... foreach t in
  array [...]` policy block) enforces that every read/write is scoped to it.
- **Engine (M3 / `src/core/engine`)** is pure, in-process TypeScript. It reads
  a `cost_tables` row and the structure's stored value; it calls no external
  service. (Today it frequently has nothing to read — `docs/BLOCKERS.md` B1:
  no cost-estimating guide has been procured, so `cost_tables` has no
  production seed. The calculation screen shows an explicit "no cost table
  loaded" state per `specs/constitution.md` §2, never a fabricated number.)
- **Determination (M4)** is a status change on one row (`determinations`),
  gated by an explicit adopt action from a `role IN ('official','admin')`
  user, audited via the `determinations_audit` trigger.
- **A1 (`src/modules/a1-letters`)** renders an HTML document server-side and
  archives it to `uploads/letters/<jurisdictionId>/<letterId>.html`. It
  refuses to render if `jurisdictions.ordinance_citation` is null
  (`docs/BLOCKERS.md` B2 — the Noblesville ordinance text has not been
  transcribed yet, so this refusal fires in every real environment today).
  The letter leaves the system as a printed page or a PDF handed to the
  property owner — the one place RiverLine's data reaches someone outside
  the jurisdiction's own staff, and it does so as a physical/PDF document the
  official controls, not an API call.
- **A3 (`src/modules/a3-sde-export`)** produces a CSV/JSON file matching the
  verified 12-residential/7-non-residential SDE element structure
  (`docs/data-contracts/sde-cost-tables.md`, FEMA P-784 Tables 3-6/3-8) for a
  human to download and hand to FEMA's SDE desktop tool. **This module's own
  code comment is explicit that it does not claim a no-re-keying import** —
  see `src/modules/a3-sde-export/types.ts`'s header and
  `docs/data-contracts/sde-export-mapping.md`. There is no API integration
  with FEMA; the "network" here is a human email or upload, outside this
  system.
- **A2 full export (`app/dashboard/export/full`)** streams every tenant table
  as a ZIP of CSVs — this is the APRA (Indiana public-records) duty build
  spec §7.6 names: "build a per-jurisdiction full export (they must be able
  to answer a records request from your system)." It is downloaded by an
  authenticated official, not published or synced anywhere automatically.

**Answer to the literal question "is data going to the network with other
users":** no. Every write and read in the built system is scoped to exactly
one jurisdiction's `jurisdiction_id`, enforced at the database via RLS, not
just in application code (build spec §7.2: "the one security property you
cannot ship without"). There is no cross-jurisdiction table, no shared feed,
no "rescue service" consumer wired up anywhere in the code as it exists
today. The closest thing to a shared destination is the human handing a
letter to a resident or a CSV to FEMA — both are files leaving through a
person, not a live integration.

---

## 2. The multi-user reality: what RLS tenancy means, and what A8 would add

### 2a. What exists today: hard per-jurisdiction isolation

`schema/core.sql`'s RLS block enables `FORCE ROW LEVEL SECURITY` on every
tenant table (`users`, `structures`, `assessments`, `assessment_elements`,
`photos`, `calculations`, `determinations`, `letters`, `audit_log`) plus
`jurisdictions` itself and `cost_tables`. Every policy predicate is the same
shape: `jurisdiction_id = current_setting('app.jurisdiction_id')`. A
jurisdiction cannot see another jurisdiction's rows even by application bug —
the database refuses the query, not the UI. This is deliberate and correct
for the MVP's stated risk (build spec §7.2: "retrofitting RLS after data
exists is how you leak Noblesville's records to Fishers") and it is why, as
of today, "Fishers" and "Noblesville" — or any two jurisdictions — are
mutually invisible to each other inside RiverLine, by design, not by
oversight.

### 2b. What A8 (multi-jurisdiction / county-level roll-up) would add

The build spec (§1.1) names A8 as an add-on: "Multi-jurisdiction admin
(county-level roll-up)." **It is not built.** No route, module, role, or
schema change for it exists in this codebase today (verified: no `a8-*`
directory under `src/modules/`, no `county` role in `users.role`'s check
constraint). What follows is a design sketch for a human to approve, not an
implementation — this task's brief explicitly says "NO implementation of new
auth roles now," and that instruction is honored below.

**The schema question A8 raises:** `users.role` is currently
`check (role in ('admin','assessor','official','viewer'))` and every role is
implicitly scoped to exactly one `jurisdiction_id` via the `users` table's
own `jurisdiction_id NOT NULL` column. A county-level "see every
jurisdiction's status" view cannot be expressed inside the current RLS model
without one of two changes, and the choice between them is a real
architectural decision, not a detail:

1. **A new `county` role plus a *read-only*, deliberately narrow
   cross-jurisdiction RLS policy** — e.g. a `county_id` on `jurisdictions`
   (which jurisdictions belong to which county; Hamilton County's own
   `nfip_cid`/`ordinance_citation` columns suggest jurisdictions already map
   1:1 to a real-world administrative unit) and a second RLS policy on the
   handful of tables a roll-up actually needs (`structures`, `determinations`,
   `calculations` counts — almost certainly NOT `photos`, `assessment_elements`,
   or `audit_log`, which are operational/evidentiary detail a county role has
   no standing reason to see) that allows `role = 'county' AND
   jurisdiction_id IN (select id from jurisdictions where county_id =
   current_setting('app.county_id'))`. This keeps write access exactly as
   isolated as today — a county user could never adopt a determination or
   edit a structure belonging to a jurisdiction that isn't theirs, only read
   aggregate/status fields.
2. **A separate materialized/aggregated table, refreshed periodically, that
   jurisdictions opt to contribute rows to** — closer to how F2 (PDA
   aggregation, §3 below) would work, and arguably the safer default: it
   never grants a county role live query access into a jurisdiction's raw
   operational tables at all, only a jurisdiction-approved summary row. This
   trades freshness (only as current as the last contribution) for a much
   smaller blast radius if the county-role policy is ever misconfigured.

Neither is implemented; recommending option 2 as the safer default is the
one opinion this document offers, precisely because option 1 needs its own
RLS policy to be independently proven correct with the same
cross-tenant-denial test discipline build spec §10.6/AGENTS.md already
requires for jurisdiction isolation (LT-6 in `docs/testing/traceability.md`),
and a second, more complex policy interacting with the first is exactly the
kind of thing that produces the leak build spec §7.2 warns about. A2's own
new operational summary (§4 below) already produces the per-jurisdiction
aggregate numbers option 2 would need to contribute — that overlap is
intentional, not incidental.

**What this document is not doing:** proposing a migration, a role, or a
route for A8. That is future work behind a real decision by a human on which
of the two shapes above (or a third) is correct, and behind an actual county
customer asking for it — consistent with build spec §1.1's own instruction:
"Do not start any A4–A8 work until an official has used M0–A3 on a real
structure," which per `docs/testing/traceability.md` has not happened yet
(every live-test procedure in that matrix is still NO COVERAGE or BLOCKED).

---

## 3. Institutional value chain: who consumes what, and what's missing

For each institutional consumer named in the build spec, this section states
plainly what RiverLine already holds that serves it, what's missing, and
cites verified sources for any external program fact.

### FEMA — SDE 3.0 export (A3, built)

**What we hold that serves it:** the full SDE 3.0 element structure (12
residential / 7 non-residential elements, verified against FEMA P-784 pp.
65-67/77 — `docs/data-contracts/sde-cost-tables.md`), per-element damage
percentages and computed costs, the calculation's ratio and threshold
result, and the determination's adoption metadata. `src/modules/a3-sde-export`
exports this as CSV/JSON matching that structure.

**What's missing:** real unit-cost dollar figures (`docs/BLOCKERS.md` B1 —
FEMA's own SDE manual publishes no dollar tables; a jurisdiction must
procure a licensed cost-estimating guide, which has not happened). Without
it, `cost_tables` has no production seed, so every real export today would
carry a `computed_cost` of `null` for every element — the export module
does not fabricate a placeholder cost, it exports the honest gap. Also
missing: independent confirmation that the exported CSV/JSON imports into
the actual FEMA SDE desktop tool without manual re-keying — the module's own
code header states it "never claims that the export imports into SDE
without re-keying," which is the correct honest posture until someone
actually runs the SDE tool against a real export (`docs/testing/traceability.md`
LT-5b, listed as BLOCKED — "no agent has installed/evaluated the FEMA SDE
3.0 desktop tool").

### The jurisdiction's own public-records obligation (A2, built)

**What we hold that serves it:** `app/dashboard/export/full` — every tenant
table, RLS-scoped, as a ZIP of CSVs with a manifest. This exists specifically
because build spec §7.6 treats it as a legal duty, not a nice-to-have:
"records created inside your tool by a public official are plausibly public
records of the jurisdiction... build a per-jurisdiction full export (they
must be able to answer a records request from your system)." This is
functionally complete for the tables that exist today.

**What's missing:** nothing structural. The gap is upstream — most of the
tables it exports are thin right now because M3's cost-table blocker (B1)
and A1's ordinance-citation blocker (B2) mean few real calculations/letters
exist yet to export. The export mechanism itself is not the gap.

### ICC (Increased Cost of Compliance) / HMGP eligibility flagging (A7, NOT built)

**What ICC is, verified:** ICC is National Flood Insurance Program coverage
that pays a policyholder up to $30,000 toward the cost to elevate,
floodproof, demolish, or relocate a structure, contingent on the building
having "substantial or repetitive damage" and being brought into compliance
with local floodplain law. Combined ICC + direct-damage payments are capped
by building type: $250,000 for residential, $500,000 for non-residential,
$250,000 × unit count for residential condos. Source: FEMA, "Increased Cost
of Compliance Coverage" (fema.gov/floodplain-management/financial-help/increased-cost-compliance,
via FEMA fact sheets fema_increased_cost_compliance_coverage_fact_sheet_02-19-15.pdf
and fema_increased-cost-of-compliance_fact-sheet.pdf), retrieved via search
2026-08-18 (direct fetch of fema.gov returns HTTP 403 to automated tools —
same finding `docs/data-contracts/fema-nfhl.md` already recorded for a
different FEMA host; this is a known limitation of this research pass, not a
claim the fact is unverified).

**What HMGP is, verified:** the Hazard Mitigation Grant Program funds
mitigation projects (elevation, acquisition, etc.) for state/local/tribal/
territorial governments. Funding becomes available after a presidential
major disaster declaration, requested by a governor or tribal executive.
Homeowners and businesses cannot apply directly — an eligible state, tribe,
or territory submits applications on their behalf via NEMIS, and applicants
must have a FEMA-approved Hazard Mitigation Plan at declaration time. Source:
FEMA, "Hazard Mitigation Grant Program (HMGP)"
(fema.gov/grants/mitigation/learn/hazard-mitigation), retrieved via search
2026-08-18. **Not independently verified in this pass:** the specific dollar
or percentage threshold connecting a *substantial damage determination*
(RiverLine's actual output) to HMGP project *eligibility scoring* — the
search did not surface that detail from a primary source, and it is not
invented here.

**What we hold that would serve this flagging:** everything a human would
need to manually assemble an ICC/HMGP-eligibility packet already exists on
an adopted `SD` determination — the ratio, the structure's SFHA zone
(`structures.sfha_zone`/`firm_panel`, sourced from the verified NFHL layer 28
join, `docs/data-contracts/fema-nfhl.md`), the calculation's cost basis, and
the determination's adoption record. A `threshold_result = 'SD'` row on an
adopted determination is, functionally, the trigger fact both programs care
about.

**What's missing:** any code path that flags it. There is no `A7` module, no
UI surface, no query that filters "adopted SD determinations, structure in
SFHA zone" into an exportable ICC/HMGP worklist. Building this later is a
small addition given what's already stored (structures + calculations +
determinations already carry every needed field) — but the file-a-claim
process itself (ICC requires an SFIP policy in force, a separate flood
insurance fact this system does not currently collect or track) is outside
what RiverLine's data model captures today, and would need `value_source`/
insurance-policy questions this project's own AGENTS.md rule 8 explicitly
forbids collecting ("insurance policy numbers... phone numbers of
residents... if a task seems to want these, stop and ask") — so A7, if
built, is a *flag/worklist* generator for the official to act on elsewhere,
never a claim-filing integration.

### PDA (Preliminary Damage Assessment) aggregation for emergency management (F2, NOT built)

**What PDA is, verified:** FEMA's Preliminary Damage Assessment process
starts at the local level, where damage details are initially collected;
state/tribal authorities then request a joint federal/state/tribal PDA
(local government representatives included where possible) if a presidential
disaster declaration looks necessary. The state/tribe/territory generally
has 30 days from incident start to determine whether federal Individual
Assistance, Public Assistance, or other programs are warranted. FEMA
publishes a PDA Guide (dated July 1, 2025) and Digital Damage Survey
templates/"Street Sheets" for collecting this data. Source: FEMA,
"Preliminary Damage Assessments" (fema.gov/disaster/how-declared/preliminary-damage-assessments)
and the PDA Guide PDF (fema_rd_pda-guide_07012025.pdf), retrieved via search
2026-08-18.

**What we hold that would serve this:** RiverLine's field capture already
produces exactly the kind of per-structure damage record a PDA needs —
address, GPS, photos, water depth, damage percentage, computed repair cost —
at a finer grain than a PDA typically requires. A2's new operational summary
(§4 below) is literally the aggregate shape ("counts by damage category, sum
of repair costs, count of adopted SD determinations") an emergency manager
compiling a PDA packet would want handed to them during an event.

**What's missing:** everything about the *aggregation and hand-off*
mechanism. There is no F2 module, no export shaped to FEMA's actual PDA
Guide/Digital Damage Survey format (not evaluated against RiverLine's schema
in this pass — that format's field-level shape was not independently
retrieved, so no field-mapping claim is made here), and no multi-jurisdiction
roll-up to feed it (see §2b — F2 and A8 would likely share the same
aggregation mechanism, one feeding a county GIS/EOC dashboard, the other
feeding a state PDA submission).

---

## 4. What NOT to build now (over-engineering guard)

Named explicitly, because the build spec (§9.6) calls over-engineering out by
name as a predictable agent failure mode, and this task's brief asks for
this section directly:

1. **No live API integration with FEMA, a county EOC system, or any external
   "rescue service" data store.** Nothing in the build spec, this task's
   brief, or any verified external source describes such an integration
   existing or being requested. Every institutional hand-off today is (and
   should stay) a human downloading a file — CSV, ZIP, or PDF — and choosing
   where it goes. That is a feature, not a gap: it means RiverLine never
   becomes a single point of failure or a silent data-sharing surface between
   jurisdictions that haven't agreed to share.
2. **No new `county` (or any other) auth role yet.** §2b sketches the schema
   shape; this task's own instructions forbid implementing it now, and there
   is no county customer asking for it yet (build spec §1.1's own gate: A4-A8
   work waits for a real official to have used M0-A3 first, which per
   `docs/testing/traceability.md` has not happened).
3. **No A7 (ICC/HMGP flagging) or F2 (PDA aggregation) module yet**, for the
   same reason — both are one-query-away given the data already collected
   (§3 above), which is exactly why building them speculatively, before a
   jurisdiction or county has actually asked for the workflow around them, is
   the over-engineering this section exists to flag. A worklist query with no
   real user to validate its shape against is guesswork with extra steps.
4. **No message queue, no event bus, no "sync to a shared datastore" layer.**
   The build spec's tech-stack section (§2) already forecloses this
   generally ("Redis, message queues, microservices... for a system that
   will hold a few thousand records"); it applies with extra force to any
   cross-jurisdiction data flow, where the actual current requirement (RLS
   isolation) is the opposite of what a shared bus would provide.
5. **No speculative "county aggregate" table populated today.** Building
   option 2 from §2b's storage layer before a county role or a real county
   customer exists would be exactly the kind of table nobody validates and
   everybody has to maintain. A2's operational summary (§4 below — the one
   change this task actually ships) intentionally stops at "a per-jurisdiction
   view + CSV export a human downloads," which is the reusable building block
   for A8/F2 later without committing to either's storage shape now.

---

## 5. Sources cited in this document

- FEMA, "Increased Cost of Compliance Coverage" — https://www.fema.gov/floodplain-management/financial-help/increased-cost-compliance (retrieved via search 2026-08-18; direct fetch blocked, HTTP 403)
- FEMA, "Increased Cost of Compliance Coverage" fact sheets — https://www.fema.gov/sites/default/files/2020-09/fema_increased_cost_compliance_coverage_fact_sheet_02-19-15.pdf, https://www.fema.gov/sites/default/files/2020-08/fema_increased-cost-of-compliance_fact-sheet.pdf (retrieved via search 2026-08-18)
- FEMA, "Hazard Mitigation Grant Program (HMGP)" — https://www.fema.gov/grants/mitigation/learn/hazard-mitigation (retrieved via search 2026-08-18)
- FEMA, "Preliminary Damage Assessments" — https://www.fema.gov/disaster/how-declared/preliminary-damage-assessments (retrieved via search 2026-08-18)
- FEMA Preliminary Damage Assessment Guide (July 1, 2025) — https://www.fema.gov/sites/default/files/documents/fema_rd_pda-guide_07012025.pdf (retrieved via search 2026-08-18)
- `docs/data-contracts/sde-cost-tables.md` — FEMA P-784 element structure, already verified 2026-08-17 by a prior research agent
- `docs/data-contracts/fema-nfhl.md` — SFHA zone/panel join, already verified 2026-08-17
- `docs/BLOCKERS.md` — B1 (cost-estimating guide), B2 (ordinance citation), B3 (market-value basis), B4 (email provider)
