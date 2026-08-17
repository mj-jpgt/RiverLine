---
# RiverLine → SDE 3.0 Export Field Mapping (T-A3)
**Status:** Export structure VERIFIED against the 12/7 element model
(`docs/data-contracts/sde-cost-tables.md`). Field-level mapping to the SDE
3.0 desktop tool's own internal storage is PARTIAL — see status column.
**Sources used:**
- `docs/data-contracts/sde-cost-tables.md` (FEMA P-784 manual, element/
  component structure, Tables 3-6 / 3-8) — cited as "P-784 pXX".
- `docs/data-contracts/sde-tool-inspection.md` (static inspection of the
  shipped `SDEDatabase.mdb` / `JSON/*.json` inside the SDE 3.0 installer) —
  cited as "inspection: <table/file>".
- `schema/core.sql` (frozen) for our own column names.

**What "VERIFIED" means here:** the exact SDE-side field/table/JSON-key name
is quoted verbatim in one of the two data-contract files above. **What
"UNVERIFIED" means:** either no SDE-side field of that name was found in the
inspected artifacts, or the concept clearly exists somewhere in the tool but
the exact internal name was not enumerated by the inspection pass (e.g. most
of the `Property` table's "~60 other fields" were never listed by column
name). Per `docs/agents/SUBAGENT.md` ("Never invent"), UNVERIFIED rows are
never given an invented name — they are marked and left alone.

## IMPORTANT — this is NOT an "imports into SDE" claim
This export is **"SDE 3.0-structured"**: it mirrors the verified 12-element
(residential) / 7-element (non-residential) breakdown from FEMA P-784 Tables
3-6 / 3-8, and where an SDE-side field name is independently verifiable from
the inspected installer payload, this doc records it for a human's reference.
**No code in this module claims, asserts, or advertises that the export
file imports into the real SDE desktop application without re-keying.**
That claim is unverifiable in this environment (no Windows install of the
tool was performed for this task — see coexistence rules) and is not made
anywhere in UI copy, API responses, or code comments.

## Field mapping

| RiverLine column (`schema/core.sql`) | SDE 3.0 concept | Source | Status |
|---|---|---|---|
| `structures.address` | Property address | `Property` table holds address per inspection doc ("owner, address, structure attributes, FIRM panel, BFE, etc.") but the exact column name was never enumerated by the inspection pass | UNVERIFIED (exact field name) |
| `structures.parcel_id` | Property/parcel identifier | same `Property` table, exact column name not enumerated | UNVERIFIED |
| `structures.occupancy_type` | Residential vs. non-residential branch | table `ResidenceType` exists in the 37-table list (inspection: `SDEDatabase.mdb` table list) — table existence confirmed, column-level detail not enumerated | VERIFIED (table exists) / UNVERIFIED (columns) |
| `structures.sq_ft` | Structure square footage (feeds `BaseCostPerSqFt` × sq ft) | concept described in P-784 pp.62/134-135 (base cost is $/sqft); no sq-ft column name enumerated in inspected `Property`/`Default` schemas | UNVERIFIED (exact field name) |
| `structures.stories` | Story count | `StoryID` — exact key, quoted verbatim in `JSON/Residential.json` and `JSON/Commercial.json` sample records (inspection doc) | VERIFIED |
| `structures.foundation_type` | Foundation type | `FoundationID` — exact key, quoted in `JSON/Residential.json` sample record (inspection doc) | VERIFIED |
| `structures.year_built` | Year of construction | `Default.YearOfConstruction` — exact column, quoted verbatim in the `Default` table's full column list (inspection doc) | VERIFIED |
| `assessments.completed_at` | Date of inspection | `Default.DateOfInspection` — exact column, quoted in the `Default` table schema | VERIFIED |
| `assessments.assessor_user_id` (→ email) | Inspector identity | `Default.InspectedBy` — exact column, quoted in `Default` table schema. (`Default.InspectedPhone` also exists but this project never collects a phone number, AGENTS.md rule 8 — not exported, not mapped.) | VERIFIED (name only; we do not populate a phone field) |
| `assessments.gps_lat` / `gps_lng` | Location | table `LatLongValidation` exists in the 37-table list — table existence confirmed, no column names enumerated | UNVERIFIED (exact field names) |
| `assessments.water_depth_interior_in` | Flood water depth | No column named for interior water depth was found. `Default.DurationOfFlood` / `DurationOfFloodUnit` exist but measure flood *duration*, a different concept — not used as a stand-in | UNVERIFIED |
| `assessments.water_depth_source` | Depth measurement provenance | no matching field found | UNVERIFIED |
| `structures.sfha_zone` | FIRM flood zone | `Default.FirmZone` — exact column, quoted in `Default` table schema | VERIFIED |
| `structures.firm_panel` | FIRM panel number | `Default.FirmPanelNumber` — exact column, quoted in `Default` table schema | VERIFIED |
| `assessment_elements.element_code` / element name | SDE element (Foundations, Superstructure, Roof Covering, ...) | `Element` — exact JSON key, quoted verbatim in `JSON/Residential.json` / `JSON/Commercial.json` sample records (values e.g. `"Foundation"`, `"Superstructure"`, `"Roof Covering"`, `"Interiors"`, `"HVAC"`), and independently the 12/7-element names themselves from P-784 Tables 3-6 (pp.65-67) / 3-8 (p.77) | VERIFIED |
| `assessment_elements.damage_pct` | Per-element damage percentage | No column of this description was found anywhere in the enumerated schema. The JSON/`ElementPercentage` table's `Percentage` field is a **different concept** — FEMA's own default *cost-allocation* percentage (how much of total replacement cost belongs to each element), not an inspector-recorded *damage* percentage — and is not used as a stand-in per "never invent" | UNVERIFIED |
| `calculations.cost_table_version` (source label) | Cost data reference/citation | `Default.CostDataRef` — exact column ("a free-text citation field for whatever guide the user picked," per inspection doc), quoted in `Default` table schema | VERIFIED (name only; semantics are "citation text," our `cost_table_version` is a version string — see note below) |
| `cost_tables.effective_date` | Cost data date | `Default.CostDataDate` — exact column, quoted in `Default` table schema | VERIFIED |
| `cost_tables` local adjustment | Local cost multiplier | `Default.LocalMultiplier` — exact column, quoted in `Default` table schema. RiverLine's cost tables carry no equivalent multiplier field today; noted for future reference, not exported | VERIFIED (field name only; not currently populated on our side) |
| `calculations.total_repair_cost` | Total computed repair cost | `CostAdjustmentResult.TotalCost` — exact column, quoted in the inspection doc's cost-table-candidate list (`UnitCost, TotalCost, Quantity, Units`) | VERIFIED (name only; table ships empty, 0 rows) |
| `calculations.market_value_used` / `value_source` | Market value used as ratio denominator | No matching field found in any enumerated table | UNVERIFIED |
| `calculations.ratio` | Damage/value ratio | No matching field found | UNVERIFIED |
| `calculations.threshold_result` (SD / NOT_SD / BORDERLINE band) | Substantial damage determination band | No matching field found | UNVERIFIED |
| `calculations.engine_version` | Calculation engine version | RiverLine-internal provenance concept; no SDE equivalent expected and none searched for | UNVERIFIED (not applicable) |
| `determinations.status` / `adopted_by_user_id` / `adopted_at` | Inspection/determination status | table `InspectionStatus` exists in the 37-table list — table existence confirmed, no columns enumerated | UNVERIFIED (exact field names) |
| `determinations.appeal_deadline_date` | Appeal deadline | no matching field found | UNVERIFIED |
| `photos.*` | Photo attachments | table `Attachment` exists in the 37-table list — table existence confirmed, no columns enumerated | UNVERIFIED (exact field names) |
| Per-element damage rating scale (not in our schema) | 6-point depreciation rating (Very Poor … Excellent) | `DepreciationValue.DepreciationPercentage` / `OriginalDepreciationPercentage` — exact columns, populated with real percentages (210 rows) in the shipped `.mdb`, and the 6-point scale itself is independently VERIFIED against P-784 Table 3-5 (pp.63-64) in `docs/data-contracts/sde-cost-tables.md` | VERIFIED — RiverLine does not currently capture a depreciation rating; not exported |

**Note on `cost_table_version` vs. `CostDataRef`:** these are not the same
shape. RiverLine's `cost_table_version` is a short version string
(`cost_tables.version`, primary key); `Default.CostDataRef` is described in
the inspection doc as free text ("a free-text citation field for whatever
guide the user picked"). The export's JSON includes both our version string
and the full `source_citation` text from `cost_tables.source_citation`
(schema/core.sql) so a human re-keying into SDE's `CostDataRef` field has
the actual citation text available, not just our internal version id.

## UNVERIFIED summary (do not treat any of these as known SDE field names)
- Exact `Property` table column names for address, parcel id, and square footage.
- Any GPS/lat-long column name (table `LatLongValidation` exists, columns unknown).
- Any water-depth column (depth, not duration).
- Any per-element damage-percentage column name.
- Market value, ratio, and substantial-damage-band column names.
- `InspectionStatus` and `Attachment` table column names (tables confirmed to exist, contents unknown).
- Whether the SDE UI's own manual data-entry screens accept a value in the
  exact same units/format RiverLine stores (e.g. inches vs. feet for water
  depth) — not checked, out of scope for a static inspection pass.

## Concrete import path a human should test with the real tool
`docs/data-contracts/sde-tool-inspection.md` confirms the SDE 3.0 desktop
tool's data file is a real, readable Microsoft Access database
(`SDEDatabase.mdb`, Jet/MDB format) with the table/column names cited above.
That said, this task is explicitly out of scope for generating or writing to
an `.mdb` file (needs an MDB-writing dependency not in this project, and
`docs/agents/SUBAGENT.md`/AGENTS.md forbid new dependencies without an ADR).
The concrete path a human should actually test:

1. Install the real SDE 3.0 desktop tool (Windows only; installer already
   retrieved at `data/raw/SDE3_04062018.zip` per the inspection doc).
2. Open a **new assessment** in the tool's own UI — do **not** hand-edit
   `SDEDatabase.mdb` directly. The Jet/MDB file format is fragile, the tool's
   own UI applies validation and referential-integrity logic that a raw table
   write would bypass, and a corrupted `.mdb` would be silently unrecoverable
   in the field.
3. Use this project's JSON export (`GET /api/sde-export/[clientId]`) as the
   checklist to key in, field by field, using the mapping table above: for
   every row marked VERIFIED, the human enters the value into the SDE screen
   that corresponds to that named field; for every row marked UNVERIFIED, the
   human uses their own judgment about where in the SDE UI that value belongs
   (RiverLine does not assert a mapping there).
4. Record whether re-keying succeeded, and where the two data models diverge
   (e.g. RiverLine's `damage_pct` per element has no confirmed SDE-side home)
   as a follow-up data-contract update — this task does not attempt that
   verification itself.

This is the honest, testable meaning of "SDE 3.0-structured export": the
element model matches exactly and is fully cited; the underlying storage
field names are recorded where verifiable and explicitly flagged where not;
whether a human can re-key without friction is left to a human with the real
tool installed, not claimed here.
