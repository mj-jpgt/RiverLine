# Live-Use Test Plan — RiverLine SDD

Executable procedures a human runs on a real iPhone against a real (or demo)
jurisdiction to prove the app works as a field tool, beyond `pnpm verify`'s
unit/E2E gates. Every threshold cited here traces to `docs/testing/standards-register.md`
(STD-N) or directly to the build spec / `direction.md` (cited inline). No
number in this file is invented.

**Known open discrepancy, flagged not resolved:** build spec §10.1 says
"11-element assessment"; `docs/data-contracts/sde-cost-tables.md` (verified
against FEMA P-784) says the residential element set is **12** elements
(Table 3-6). This plan tests against the **verified 12-element set** per
`specs/constitution.md` §3 ("the build spec §4.3's 8-item list is corrected
and must not be used" — the same correction principle applies to any other
build-spec element count). LT-1 records the actual count exercised and flags
if it does not match 12; this is not this agent's call to silently resolve,
per SUBAGENT.md "if something is ambiguous, stop and ask."

## How to use this file

Each procedure has an ID (LT-N, OT-N, FC-N, DI-N). Run them with
`docs/testing/session-log-template.md` open — one template instance per
session, one row per procedure. "Automatable" means a Playwright spec can
assert it in CI; "Human" means it requires a physical device, physical
conditions (sunlight, gloves), or a second physical device/person and cannot
be reasonably simulated. Procedures marked "Human (partial)" have an
automatable sub-check plus a human-only sub-check.

---

## Part 1 — Build spec §10 acceptance run (the six MVP criteria)

Run in order, on one real structure, in one session, exactly as the build
spec frames it: "you playing assessor and a colleague playing official."

### LT-1 — Login → address search → 11/12-element assessment with photos, under 12 minutes including 3 minutes airplane mode

**Source:** build spec §10.1.

**Preconditions:**
- Real iPhone, installed to home screen (per ADR 0002, `getUserMedia`/camera
  behavior differs in standalone vs. Safari-tab mode — test the mode users
  will actually use).
- A real (or demo — "123 Practice Ln," build spec §6.7) structure exists in
  the jurisdiction.
- Assessor account provisioned via magic-link invite (no self-signup, build
  spec §7.1).
- Stopwatch visible to the tester, not the app.

**Script:**
1. Open the installed PWA. Request magic link, follow it, confirm session
   starts. **Start stopwatch at first tap on the login screen.**
2. Search for the structure by address (not by tapping a list item chosen in
   advance — type a partial address as a real user would).
3. Open the structure, start a new assessment.
4. Walk every element (12 residential / 7 non-residential per
   `docs/data-contracts/sde-cost-tables.md`). For each: set damage % via
   preset buttons (0/10/25/50/75/100, build spec §5.3 — confirm no slider is
   present, per `ui-review-checklist.md` Part A), capture at least one photo
   per element, capture the required exterior shot (build spec §6.1).
5. **At a natural midpoint (after element 5 or 6), enable iPhone Airplane
   Mode. Continue the assessment for exactly 3 minutes with airplane mode
   on** — keep capturing elements/photos during this window, do not pause the
   flow. Confirm the offline banner appears within one screen transition of
   airplane mode being enabled (build spec §6.2, "persistent visible
   banner... never a silent failure").
6. Disable airplane mode. Finish remaining elements.
7. **Stop stopwatch when the assessment is marked complete** (last screen
   advance past the final element/exterior-shot screen).

**Pass/fail:**
- Total elapsed time (login start → assessment complete) **≤ 12 minutes**,
  of which **≥ 3 minutes** were airplane-mode time (build spec §10.1, exact
  wording).
- Every element has a damage % and at least one photo; exterior shot present.
- Offline banner visible for the entire airplane-mode window, no silent
  failure, no lost data on re-enabling network.
- Actual element count exercised recorded in the session log; flagged if ≠12
  residential / ≠7 non-residential.

**Evidence to capture:** stopwatch splits (login-done, airplane-on,
airplane-off, assessment-done timestamps), screen recording or timestamped
screenshots of the offline banner, a DB query after sync showing
`assessment_elements` row count = element count for the occupancy type,
`photos` row count ≥ element count + 1 (exterior).

**Automatable:** partial. Playwright + `page.context().setOffline(true)` can
drive the full element flow and assert autosave-to-IndexedDB + banner
rendering (this is what `pnpm test:offline` is *for* — see traceability.md
T-C3). The 12-minute wall-clock budget, real iPhone Safari camera behavior,
and real Airplane Mode (vs. simulated `setOffline`) require a human with a
physical device — `setOffline` does not exercise the same iOS network stack
or camera-permission-on-every-mount behavior ADR 0002 documents.

---

### LT-2 — Sync → calculation with visible cost-table version and value source

**Source:** build spec §10.2, §5.4, §3 (`calculations` schema columns).

**Preconditions:** LT-1 completed; a real `cost_tables` row loaded for the
jurisdiction (if none — `specs/constitution.md` §2 explicit "no cost table
loaded" state applies; that is its own procedure, see LT-2b).

**Script:**
1. Re-enable network if not already. Confirm sync completes — either
   automatically (foreground/visibility trigger per ADR 0002, not a
   background-sync event) or via manual retry button.
2. Open the resulting calculation screen.
3. Read the displayed cost-table version, value source, market value used,
   total repair cost, ratio, and threshold_result.

**Pass/fail:**
- Sync completes without requiring app restart; offline queue count in the
  banner reaches 0.
- Calculation screen shows: `cost_table_version` (non-null, matches a real
  `cost_tables.version` row), `value_source` (matches `structures.value_source`),
  ratio computed, `threshold_result` in {NOT_SD, BORDERLINE, SD} per the
  45%/55% band (build spec §5.5).
- Ratio math spot-check: tester hand-computes total repair cost ÷ market
  value used from the visible element data and confirms it matches the
  displayed ratio to within rounding.

**Evidence:** screenshot of the calculation screen; DB query on
`calculations` showing `cost_table_version`, `engine_version`, `ratio`,
`threshold_result` populated and non-null.

**Automatable:** yes, once M3/sync exist — Playwright can assert the
calculation screen's DOM shows all required fields, and a DB query can
assert schema-level non-null constraints. Golden-fixture math correctness is
already covered by `test/fixtures/engine/` (T-C4) — this procedure is the
live, end-to-end version of the same claim, not a duplicate of the unit math.

### LT-2b — No cost table loaded (explicit state, not a crash)

**Source:** `specs/constitution.md` §2 — "if none is loaded for the
jurisdiction, the capture flow completes and stores the assessment, and the
calculation screen shows an explicit 'no cost table loaded — see
docs/BLOCKERS.md B1' state."

**Script:** run LT-1 for a jurisdiction with zero rows in `cost_tables`.

**Pass/fail:** assessment still saves and syncs (capture flow must not be
blocked by a missing cost table); calculation screen shows the literal
"no cost table loaded" state referencing B1, not a stack trace, not a blank
screen, not a fabricated $0 total.

**Automatable:** yes — Playwright spec against a jurisdiction fixture with
an empty `cost_tables` table.

---

### LT-3 — Official review: override one element with reason, adopt

**Source:** build spec §10.3, §5.6, SUBAGENT.md "Role: test agents" item 4
("override with missing reason").

**Preconditions:** LT-2 calculation exists in `draft` status.

**Script (as the "colleague playing official"):**
1. Official logs in (separate account, role `official`).
2. Opens the review queue — confirm borderline-first sort if any borderline
   items exist (build spec §5.6).
3. Opens the assessment under review. Confirm every input, value source,
   cost-table version, and side-by-side photos are visible (build spec §5.6
   literal requirement).
4. **Attempt to override an element with an empty reason field.** Confirm
   the adopt/save action is blocked and a designed inline error explains
   what's missing (`ui-review-checklist.md` Part B "Designed error states" —
   no default browser alert).
5. Enter a real reason. Override one element's damage % or the market value.
6. Adopt the determination (explicit action, not automatic — build spec
   §5.6, AGENTS.md rule 12 "never auto-adopt").

**Pass/fail:**
- Override without reason is blocked with a visible, specific error.
- Override with reason succeeds; `audit_log` gets a row with
  `entity_type='determinations'` (or the overridden entity), `before_json`/
  `after_json` populated, `actor_user_id` = official's user id.
- `determinations.status` transitions to `adopted` only after the explicit
  adopt tap — never on override alone.
- `determinations.adopted_by_user_id` and `adopted_at` populated.

**Evidence:** screenshot of the blocked-empty-reason state; DB query on
`audit_log` and `determinations` post-adopt.

**Automatable:** yes — this is exactly the kind of "clicks the real control,
asserts the real state change" spec SUBAGENT.md requires; T-C5's acceptance
check already names this scenario.

---

### LT-4 — Letter generation: blocked state when ordinance citation is null

**Source:** task brief correction to build spec §10.4 — per
`specs/constitution.md` §2 and `docs/BLOCKERS.md` B2, the ordinance citation
is **currently and correctly null** (Cloudflare-blocked retrieval, human
action required). The MVP-correct behavior is refusal, not letter
generation. This procedure replaces a literal reading of build spec §10.4
("a letter PDF generates with correct ordinance citation...") because that
sentence describes the state *after* B2 is resolved by a human, which has
not happened as of this test plan's authoring (2026-08-17).

**Script:**
1. From an adopted determination (LT-3 output), trigger letter generation
   (A1).
2. Confirm the jurisdiction's `ordinance_citation` is null (check
   `jurisdictions` row, or trust `docs/BLOCKERS.md` B2's current status).

**Pass/fail:**
- Letter generation **refuses**, with a visible state reading something to
  the effect of "ordinance citation missing — see docs/BLOCKERS.md B2."
- **Hard fail conditions (any one of these is an automatic bounce):** a
  placeholder string, "Lorem ipsum," a fabricated/generic citation, a blank
  citation field silently left empty in an otherwise-generated PDF, or a PDF
  that generates at all with no ordinance text present. Per AGENTS.md rule 4
  and `specs/constitution.md` §2, a generated citation is worse than no
  letter.
- No PDF is produced; no `letters` row is inserted.

**Re-run after B2 is resolved:** once a human transcribes the real ordinance
text (`docs/BLOCKERS.md` B2 steps), re-run this procedure as **LT-4b**: full
letter generates with the real citation text verbatim-matching
`docs/data-contracts/ordinance-citations.md`, appeal language, ICC
instructions present, and — per build spec §6.5 and the Print section of
`direction.md` — **prints legibly on a real municipal printer, tested on
actual paper**, black on white, no color-dependent information.

**Evidence:** screenshot of the refusal state; confirm zero `letters` rows
for that determination in the DB.

**Automatable:** the refusal-state check (LT-4) is fully automatable now —
it is in fact a stronger, more specific test than "letter generates
correctly" and should exist in `test/e2e/` today, not wait for B2. The
print-legibility check (LT-4b) is human-only — no automated test verifies
ink-on-paper legibility.

---

### LT-5 — Dashboard reflects caseload; SDE export structure check

**Source:** build spec §10.5, §4.3 (corrected 12/7-element structure).

**Script:**
1. Open the dashboard (A2) as an admin/official. Confirm the adopted
   determination from LT-3 appears with correct status color + label (never
   color alone, `direction.md` "Color and meaning").
2. Confirm CSV export is available and downloads (build spec §6.4 "CSV
   export always available").
3. Trigger SDE-compatible export (A3) for the same determination.
4. Inspect the export's element list against
   `docs/data-contracts/sde-cost-tables.md`'s verified 12-element (Table
   3-6) or 7-element (Table 3-8) structure, matched to the structure's
   occupancy type.

**Pass/fail:**
- Dashboard status count includes the new determination within one
  page-load/refresh of adoption.
- CSV export opens in a spreadsheet tool without malformed rows.
- SDE export element codes/order match the verified table exactly — this is
  a structural check (does the export's schema match SDE's), not a live
  import into FEMA's actual desktop SDE 3.0 application, which build spec
  §10.5 also calls for ("imports into FEMA's SDE tool without manual
  re-keying") — **that live-import check is out of scope for this pass and
  is flagged as its own procedure below (LT-5b)**, since it requires the
  actual Windows SDE 3.0 desktop installer (noted as not evaluated in
  `docs/data-contracts/sde-cost-tables.md` "How to obtain").

**LT-5b — Live SDE import (human, requires desktop tool):** install FEMA's
SDE 3.0 desktop application (link in `docs/data-contracts/sde-cost-tables.md`),
import the A3 export file, and confirm it opens with no manual re-keying and
no field-mapping errors. **Currently blocked**: no prior agent has installed
or evaluated the desktop tool (explicitly out of scope for that research
pass). Record as an open gap until someone does this once.

**Automatable:** dashboard status/count and CSV shape — yes, Playwright + a
CSV-parse assertion. SDE export element-structure match against the data
contract — yes, a unit/snapshot test comparing export keys to the 12/7 list.
Live import into the actual FEMA desktop tool — no, human-only, and blocked
on tool installation besides.

---

### LT-6 — Cross-tenant denial, audit chain query, backup restore

**Source:** build spec §10.6, §7.2, §7.5.

**Script:**
1. As a user of jurisdiction A, attempt to fetch/view a structure or
   determination belonging to jurisdiction B (by ID guess or direct API
   call, not just UI navigation — RLS must hold at the DB layer per build
   spec §7.2, "Application-level filtering is not sufficient").
2. Confirm denial (403/empty result, not a leaked row).
3. Query `audit_log` for the full LT-3 adoption chain: assessment created →
   synced → calculation computed → element overridden → determination
   adopted. Confirm every step has a row with correct `actor_user_id`,
   `before_json`/`after_json`, and timestamp ordering.
4. Trigger (or confirm existence of) last night's automated `pg_dump`
   (build spec §7.5). Restore it to a scratch database. Confirm the restored
   DB contains the LT-1..LT-5 data created in this session (if the backup
   predates this session, confirm it at least restores cleanly and matches
   expected schema/row counts from before the session).

**Pass/fail:**
- Cross-tenant request returns no jurisdiction-B data under any role.
- Audit chain query returns a complete, correctly ordered sequence with no
  gaps.
- Restore completes without error; row counts and a spot-checked
  determination match the pre-restore source.

**Evidence:** the cross-tenant test's HTTP response/DB error; the audit
chain query and its output, saved verbatim; the restore command output and
a post-restore row-count query.

**Automatable:** cross-tenant denial — yes, this is explicitly called out in
build spec §7.2 as a CI-tested property already (T-C1 acceptance: "a
cross-tenant test that INSERTs two jurisdictions and proves tenant A cannot
read tenant B"). Audit chain query — yes, scriptable. Backup restore — human
(or a scheduled CI job against a scratch instance), since it exercises real
infra (`pg_dump`/`pg_restore`) build spec §7.5 explicitly says to test once
before pilot, not something to fake in a unit test.

---

## Part 2 — Offline torture tests

**Source:** build spec §2 item 5 (offline/conflict design), ADR 0002 (iOS
platform facts), AGENTS.md rule 7 (sync error policy), task brief.

### OT-1 — Airplane mode mid-photo capture

**Script:** start element capture, begin taking a photo, enable airplane
mode mid-capture (during the camera UI, before the photo is confirmed).

**Pass/fail:** photo capture either completes locally and queues (photo
saved to IndexedDB/local storage, `sync_status` reflects pending) or fails
with a visible, specific error — never a silent loss and never a crash.
Per AGENTS.md rule 7, no empty catch block; failure must surface visibly.

**Automatable:** Human — depends on real iOS camera UI timing that
`setOffline` cannot reproduce exactly (ADR 0002 notes camera behavior in
standalone PWA mode is "genuinely fragile across iOS point releases").

### OT-2 — Kill app mid-assessment

**Script:** mid-assessment (after ≥2 elements entered, before completion),
force-quit the PWA from the iOS app switcher. Reopen.

**Pass/fail:** on reopen, the assessment resumes with all previously-entered
elements/photos intact — build spec §6.1's literal claim: "every screen
auto-saves to the local queue on advance... killing the app loses nothing."
No re-entry required for completed elements.

**Automatable:** Human (device-level force-quit) — `ui-review-checklist.md`
already specifies this exact check ("confirm by killing the tab mid-flow and
reloading") as a Playwright-reachable proxy (closing/reopening the page
context can approximate app-kill for CI), so this is **Human (partial)**:
CI proxy exists, but the real iOS app-switcher kill is the authoritative
check.

### OT-3 — Sync retry after 3 failures

**Script:** queue an assessment offline. Bring network back but block the
sync endpoint specifically (e.g., via a proxy or by pointing DNS at a dead
host) for 3 consecutive sync attempts. Then restore the real endpoint.

**Pass/fail:** each failed attempt retries with backoff (AGENTS.md rule 7 —
"retry with backoff, then surface visibly"); after repeated failure the
queued-count banner is still visible and now also surfaces a visible error/
retry-needed state, not silent infinite retry with no indication; once the
endpoint is restored, the next trigger (foreground, `online` event, or
manual retry button — ADR 0002, never a background-sync event) succeeds and
the queue clears.

**Automatable:** yes — Playwright + a mock/failing sync route is a clean way
to assert backoff timing and the visible-error state deterministically
(more reliable than a human timing 3 real failures by hand).

### OT-4 — Two devices editing the same assessment (last-write-wins per field + audit)

**Source:** build spec §2 item 5, `specs/constitution.md` §5 (sync via
`assessments.client_id`, idempotent), STD-10.

**Script:**
1. Two devices (or two browser contexts simulating two devices) open the
   same assessment while both are offline.
2. Device A edits element 3's damage % to 50; Device B edits element 3's
   damage % to 75 and also edits element 5's notes.
3. Bring both online, in a known order (A syncs first, then B).

**Pass/fail:**
- Final state is **per-field** last-write-wins: element 3 ends at whichever
  device's write has the later `device_captured_at`/sync timestamp — not a
  whole-record overwrite that would also silently discard Device A's
  untouched fields.
- Element 5's note from Device B is preserved (it was never touched by
  Device A, so there's no conflict to resolve there — this specifically
  tests that "last-write-wins" is scoped per-field, not per-record).
- An `audit_log` entry exists recording the conflict resolution (which value
  won, both devices' submitted values if feasible) — build spec §2.5's
  explicit requirement: "never silent overwrite of a whole record."

**Automatable:** yes, once the sync/conflict logic exists — two Playwright
browser contexts against the same backend, asserting final DB state and the
audit_log row. This is the highest-value automatable offline test in this
section and should exist as a Playwright spec, not remain human-only.

### OT-5 — Idempotent sync retry (duplicate submission)

**Source:** `specs/constitution.md` §5 ("Sync endpoint is idempotent via
`assessments.client_id`"), data/backend role rules in SUBAGENT.md ("the sync
endpoint must be idempotent — field devices retry").

**Script:** submit the same queued assessment's sync payload twice (simulate
a field device that retried after a timeout but the first request actually
succeeded server-side).

**Pass/fail:** no duplicate `assessments`/`assessment_elements`/`photos`
rows; second submission is a no-op or explicit "already synced"
acknowledgment, not a duplicate insert or an error that re-queues forever.

**Automatable:** yes — direct API-level test, no UI needed.

---

## Part 3 — Field-conditions usability checks

**Source:** build spec §6, `direction.md`, `ui-review-checklist.md`
"Field-conditions and accessibility floor," STD-1 through STD-4.

Each check is a **measurable proxy**, not a subjective impression — record
the actual measured number in the session log, not a pass/fail alone.

| ID | Check | Measurable proxy | Threshold | Source |
|----|---|---|---|---|
| FC-1 | Tap target size | DevTools/Safari Web Inspector box model on every interactive element in the capture flow | **≥48×48px**, ≥8px gap to adjacent targets | STD-4 (project floor); STD-1 (24px = legal AA floor if 48 is ever exceptioned) |
| FC-2 | Contrast / glare legibility | `node scripts/check-contrast.mjs` against `tokens.css`, plus outdoor daylight visual check | **≥4.5:1** normal text, **≥3:1** large text/non-text UI | STD-3 |
| FC-3 | One-handed reach | Hold phone in one hand, thumb-only, complete one full element (damage % + photo) without repositioning grip | No control requires the off-hand; primary actions reachable in the lower 2/3 of a standard iPhone screen | build spec §6.1 "one decision per screen," `direction.md` acceptance question ("could an official use it one-handed") |
| FC-4 | Glove/wet-hands proxy | Tap-target size + spacing (FC-1) doubles as the glove proxy per direction.md ("sliders are unusable with wet hands" — the mitigation is button size, not a separate wet-glove test rig) | Same as FC-1, plus: zero sliders present anywhere numeric input occurs (`ui-review-checklist.md` Part A) | `direction.md` §6.1, §"Field conditions are the acceptance environment" |
| FC-5 | Status legible without color | View every status badge (NOT_SD/BORDERLINE/SD/Draft) in DevTools grayscale rendering emulation | Status still identifiable via label text alone | `direction.md` "Color and meaning"; `ui-review-checklist.md` |
| FC-6 | Tap responsiveness | Tap any interactive control, observe for a visual change (pressed state/color shift) | Response within one frame, no dead half-second | `direction.md` "Smooth, not decorative" #1 |
| FC-7 | Onboarding budget | New assessor (no training call) completes the demo structure ("123 Practice Ln," build spec §6.7) assessment | **≤10 minutes** | build spec §6.7, exact wording |

**Automatable:** FC-1, FC-2, FC-5, FC-6 have automatable sub-checks
(DevTools box-model queries and the contrast script can run headlessly;
grayscale rendering can be simulated via CSS filter in a Playwright trace).
FC-3, FC-4 (the actual physical one-handed/glove experience), and FC-7 (a
genuinely untrained tester) are **Human-only** — there is no automated proxy
for "does this feel usable one-handed in the mud."

---

## Part 4 — Data-integrity spot checks

**Source:** AGENTS.md rules 10–11, build spec §3 schema notes,
`specs/constitution.md` §1, SUBAGENT.md "Role: data / backend agents."

### DI-1 — Calculation re-run inserts a new row, never updates

**Script:** for an existing assessment with a calculation, trigger a
re-calculation (e.g., after a cost-table version changes, or an official
requests a re-run).

**Pass/fail:** a **new** `calculations` row appears with a new `id`, the new
`cost_table_version`/`engine_version`, and the old row is untouched
(`before_json`-style comparison: old row's every column identical to before
the re-run). Any UPDATE statement touching `calculations` in application
code is a hard fail regardless of the resulting data looking correct.

**Automatable:** yes — DB-level assertion, trivial to script; should exist
as a Vitest/integration test today, independent of live-device testing.

### DI-2 — Superseded flow (determinations never deleted)

**Script:** adopt a determination (LT-3), then trigger whatever "this
determination is wrong, redo it" flow exists (contested → new assessment →
new determination).

**Pass/fail:** original `determinations` row's `status` becomes
`superseded`, row still exists (`SELECT` still returns it), no DELETE
executed. A new `determinations` row is created for the corrected outcome,
linked in a way that's queryable (e.g., points at the same `structure_id`,
distinguishable by `status` and timestamp — exact linkage depends on M4's
implementation; record what's actually observed).

**Automatable:** yes — DB assertion.

### DI-3 — Immutability probes (negative tests)

**Script:** attempt direct application-level actions that should be
impossible: (a) call any code path that would UPDATE a `calculations` row,
(b) call any code path that would DELETE a `determinations` row, (c) attempt
to edit an already-`adopted` determination's core fields without going
through the supersede flow.

**Pass/fail:** each attempt is rejected — by application logic, DB
constraint, or RLS policy — with a visible/logged reason, never a silent
no-op that could be mistaken for success.

**Automatable:** yes — this is exactly the shape of "test against the spec,
not the implementation" SUBAGENT.md's test-agent role describes: write the
test for the rule (AGENTS.md rules 10/11), not for whatever the code
currently happens to allow.

### DI-4 — Photo content-hash integrity

**Script:** upload a photo during capture; after sync, fetch the stored
photo and recompute its SHA-256; compare to `photos.sha256`.

**Pass/fail:** hash matches exactly (build spec §3: "Photos are
content-hashed (SHA-256) at upload; hash stored on the assessment record").
Also confirm EXIF is retained on the stored original and stripped only on
any public-facing (A6) serve path (build spec §7.4) — if A6 doesn't exist
yet, record this half as NO COVERAGE rather than skipping silently.

**Automatable:** yes.

---

## Session cadence

Run Part 1 (LT-1..LT-6) as one continuous session whenever a change touches
M0–M4/A1–A3, per build spec §10's own framing ("If any of these six fail,
the MVP is not done"). Run Part 2/3/4 checks whenever the relevant module
changes, not necessarily every session. Every run, human or automated, gets
one row in `docs/testing/session-log-template.md`.
