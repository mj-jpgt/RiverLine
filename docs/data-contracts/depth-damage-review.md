---
# Depth-Damage Functions (DDFs) — Can They Suggest Per-Element Damage Percentages?
**Status:** RESOLVED — verdict: NO, not with the sources available to this project. DDFs are
whole-structure (or whole-structure-and-contents), not per-element, so mapping one to SDE's
12/7 per-element `damage_pct` fields would be an invented methodology, not a documented one.
**Task:** G4 intelligence pass, 2026-08-18. Research required before any triage/suggestion
feature could legitimately pre-fill or flag per-element damage inputs.
**Retrieved by:** G4 agent, 2026-08-18.

## The question

RiverLine's engine (`src/core/engine`, untouchable) computes the substantial-damage ratio from
per-element damage percentages the assessor enters in the field (`assessment_elements.damage_pct`,
one row per SDE 3.0 element — 12 residential / 7 non-residential, `docs/data-contracts/sde-cost-tables.md`).
Could a depth-damage function — given a recorded water depth (`assessments.water_depth_interior_in`)
and occupancy/foundation/stories — legitimately pre-suggest what each *individual element's* damage
percentage should be, the way a triage assistant would? That would be a real time-saver if it were
defensible. AGENTS.md rule 4 and `specs/constitution.md` §2 forbid inventing a methodology that
feeds a legal determination, so this had to be verified against primary sources before building
anything that touches `damage_pct`.

## What was checked

### 1. USACE Economic Guidance Memorandum (EGM) 04-01 — primary source, read directly

- **URL:** https://planning.erdc.dren.mil/toolbox/library/EGMs/egm04-01.pdf
- **Title:** "Economic Guidance Memorandum (EGM) 04-01, Generic Depth-Damage Relationships for
  Residential Structures with Basements," CECW-PG, 10 October 2003, HQUSACE.
- **Retrieved:** 2026-08-18. Fetched and read page-by-page (not summarized secondhand — an initial
  automated fetch of this same PDF mis-described it as giving "component-level" percentages; that
  summary was wrong, produced by a fast model skimming compressed PDF byte streams, and is called
  out here specifically as a caution against trusting a single indirect fetch on a load-bearing
  fact. The actual document was then read directly, page by page, to confirm.)

**What the tables actually contain** (p.6–8, "Damage Functions for Single Family Residential
Structures with Basements," Tables 1–3): for each of three structure types (one-story with
basement, two-or-more-story with basement, split-level with basement), a single two-column table —
**flood depth in feet (relative to first floor, -8 to +16) → mean percent damage to the WHOLE
STRUCTURE, plus a standard deviation.** Example, Table 1 (one-story with basement): depth 0 ft →
25.5% mean structure damage; depth 4 ft → 52.2%; depth 8 ft → 74.2%; damage plateaus above depth 10.
Content damage is a second, separate curve, likewise expressed as "a percentage of structure value"
for the whole dwelling's contents, not broken into per-item or per-room components (p.2, §3b–c).

**There is no element, component, or system breakdown anywhere in this document.** No row,
column, or footnote assigns a percentage to "foundation," "electrical," "plumbing," "interior
finish," or any of the SDE 3.0 elements. The memo's own stated use is as an input to HEC-FDA
(the Corps' flood-damage-reduction planning software) for benefit-cost studies of mitigation
projects — a single stage-damage curve per structure, not a per-element damage estimate for a
substantial-damage determination.

- Companion note (p.2, §3): "Generic damage functions are attached for one-story homes with
  basement, two or more story homes with basement, and split-level homes with basement.
  Generic damage functions for similar structures without basements were published in 2000."
  (i.e., the whole-structure-only shape is consistent across the full family of USACE generic
  DDFs, not an artifact of the basement variant specifically.)

### 2. FEMA BCA Toolkit DDFs — corroborating, via search summary (not independently re-verified page-by-page in this pass; treated as corroborating, not load-bearing)

- FEMA's Benefit-Cost Analysis (BCA) Toolkit assigns a DDF to each input building "according to
  its vulnerability attributes" (occupancy type, foundation type, number of stories), and expresses
  the relationship as "depth versus percentage damage to the element being considered" where the
  "element" in BCA usage means the whole asset under analysis (a building, a vehicle, a road
  segment) for economic-loss purposes — not a building sub-component. Source: FEMA BCA Reference
  Guide (2009) and BCA Instructor Guide Unit 5, both hosted at fema.gov (searched 2026-08-18, URLs:
  https://www.fema.gov/sites/default/files/2020-04/fema_bca_reference-guide.pdf,
  https://www.fema.gov/sites/default/files/2020-04/fema_bca_instructor-guide_unit-5.pdf). This is
  the same shape as EGM 04-01: one curve per structure, not per building system.

### 3. FEMA SDE 3.0 itself — how the tool that actually produces `damage_pct` inputs is designed

Already on file at `docs/data-contracts/sde-cost-tables.md` and `docs/data-contracts/sde-tool-inspection.md`
(verified against the shipped SDE 3.0 installer, retrieved 2026-08-17). Two facts from that prior
research are directly relevant here and confirm the verdict from the other direction:

- SDE's per-element numbers that *are* auto-populated (`JSON/Residential.json`,
  `JSON/Commercial.json`, `ElementPercentage` table) are **cost-allocation percentages** — "what
  share of a structure's total replacement cost this element represents," keyed by structure
  attributes (foundation type × superstructure × roof × exterior finish × HVAC × stories). They
  are static allocation weights, not damage estimates, and not a function of flood depth at all.
- The field that actually varies with observed damage — `damage_pct`, "how damaged is this
  specific element" — has **no default, no formula, no lookup table anywhere in the shipped SDE
  tool.** It is entered by the inspector from direct visual observation of that element, per
  element, per FEMA's own manual (Section 3, `sde-cost-tables.md`). FEMA built SDE this way on
  purpose: elements at the same water depth do not damage equally (a slab foundation and a
  gypsum-board interior wall react completely differently to 3 feet of water for the same
  duration), which is exactly why the field tool asks a human to look at each element instead of
  computing it from depth.

## Verdict

**No.** Depth-damage functions from USACE and FEMA's BCA program are whole-structure (or
whole-structure-and-contents) curves keyed to flood depth and gross building attributes
(occupancy, foundation type, stories). They were built for a different purpose — estimating
aggregate structure/content loss for flood-reduction benefit-cost economics — and contain no
per-element breakdown of any kind. Deriving a per-element `damage_pct` suggestion from a DDF would
require inventing an allocation methodology (e.g., "assume the DDF's whole-structure percentage
applies uniformly to every element," or "assume it concentrates in water-line-adjacent elements
in some invented ratio") that appears in none of the sources reviewed. That is precisely the kind
of fabricated methodology AGENTS.md rule 4 and `specs/constitution.md` §2 exist to block, and it
would look legitimate on screen while being unsourced — the exact failure mode
`docs/agents/ORCHESTRATOR.md` calls "the most dangerous failure in this project."

**Consequence for this task:** no per-element damage suggester was built. G4's "intelligence"
instead does triage/prioritization and read-time accuracy flags over data the assessor already
recorded (see below) — arithmetic and sorting, never a filled-in number that could pass for a
field observation.

## What a defensible future version would need

If a jurisdiction wants a "suggest starting per-element percentages from observed depth" feature
someday, it needs a source that actually ties depth to *element*-level damage, entered and owned
by a human, not derived by RiverLine from a whole-structure curve. The pattern this codebase
already uses for the parallel problem (unit costs) is the template: `cost_tables` requires a
`source_citation` and a human-loaded `json_payload`, and the app refuses to compute without one
(`specs/constitution.md` §2, schema/core.sql `cost_tables`). A future `element_damage_suggestion_tables`
(or similar) would need the same shape:

1. A jurisdiction-scoped, admin-entered table (loaded the same way `cost_tables` is loaded today —
   see `app/admin` cost-table upload flow) mapping `(occupancy, water_depth_bucket) -> {element_code: suggested_damage_pct}`,
   with a mandatory `source_citation` field the app refuses to compute without, exactly like
   `cost_tables.source_citation` is enforced today.
2. That source would have to be either (a) a jurisdiction's own historical claims data analyzed
   per-element (the same regression approach EGM 04-01 used, but run on per-element loss records
   instead of whole-structure ones — no such public dataset was found in this pass), or (b) a future
   FEMA/USACE publication that explicitly breaks DDFs out by SDE element (none exists today, per
   the sources above).
3. Any resulting suggestion would render as a clearly labeled, editable starting point the
   assessor must actively accept or change per element — never a silently pre-filled value — the
   same "the tool proposes, the official adopts" posture AGENTS.md rule 12 already requires for
   determinations, extended to the capture step.
4. Until (1)-(3) exist, the honest state is what this pass ships: no per-element suggestion, and
   a plain-language reason why, surfaced nowhere as a number.

## Sources

- [EGM 04-01 — Generic Depth-Damage Relationships for Residential Structures with Basements](https://planning.erdc.dren.mil/toolbox/library/EGMs/egm04-01.pdf) — USACE, CECW-PG, 10 October 2003. Retrieved 2026-08-18. Tables 1-3, p.6-8 (whole-structure depth-damage %); §3, p.2 (methodology, content-damage-as-%-of-structure-value); §4, p.2-3 (HEC-FDA application, confirms per-structure not per-element use).
- [FEMA BCA Reference Guide (2009)](https://www.fema.gov/sites/default/files/2020-04/fema_bca_reference-guide.pdf) — corroborating, DDF definition and application description, searched 2026-08-18.
- [FEMA BCA Instructor Guide, Unit 5](https://www.fema.gov/sites/default/files/2020-04/fema_bca_instructor-guide_unit-5.pdf) — corroborating, searched 2026-08-18.
- `docs/data-contracts/sde-cost-tables.md` (already on file, retrieved 2026-08-17) — SDE 3.0 element list and manual text confirming `damage_pct` is a field-observed value per element.
- `docs/data-contracts/sde-tool-inspection.md` (already on file, retrieved 2026-08-17) — direct inspection of the shipped SDE 3.0 tool's database/JSON, confirming its only auto-populated per-element numbers are static cost-allocation percentages, not damage percentages, and that no depth-to-damage lookup exists anywhere in the shipped product.
- Windshield-survey / rapid-triage grounding for the priority-score design (§ below, not the DDF question): [USFA "Development of a Rapid Windshield Damage Assessment" (EFOP)](https://apps.usfa.fema.gov/pdf/efop/efo46484.pdf); [USFA "Windshield Damage Assessment"](https://apps.usfa.fema.gov/pdf/efop/efo44654.pdf) — searched 2026-08-18. General pattern confirmed: rapid/triage pass (hours-days) sorts cases for a slower, detailed follow-up pass; triage criteria are cheap-to-observe severity signals, not the detailed assessment itself. RiverLine's existing borderline-first queue ordering already follows this pattern; the priority score below only refines ordering *within* that pattern using data already on file.

## Triage design grounded in this research (implemented — see journal)

Because no defensible per-element suggester exists yet, the "intelligence" built this pass is
triage ordering (sort, don't fabricate) and read-time flags (point at what to check, don't answer
it). Both operate only on numbers RiverLine already computed or recorded — no new fact is
introduced. See `src/core/intelligence/` and `docs/journal/2026-08-18-g4-intelligence.md` for the
implementation and the exact formula, shown verbatim in the review queue's "Why this order?"
disclosure so a reviewer never has to trust an opaque score.
