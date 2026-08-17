# ADR 0005: Cost-Estimating Guide for SDE Base Cost Figures

**Status:** Proposed — Decision Pending (requires human procurement/budget and license review; not decidable by an agent)
**Date:** 2026-08-17
**Author:** research agent

## Context

FEMA's SDE 3.0 User Manual and Field Workbook (already retrieved and cited in
`docs/data-contracts/sde-cost-tables.md`) states that the 50%-rule engine's base
repair/replacement cost must come from an external, community-selected source:

> "The base cost can be obtained from an industry-accepted, residential
> cost-estimating guide, contractor's estimates, and community estimates from
> local building and repair permits, or professional appraisers." (SDE manual,
> PDF p.62, printed p.3-36)

> "Sources of base cost data include: Industry-accepted, residential or
> non-residential cost-estimating guides; Local permit data...; Professional
> experience by a community official... the price of the guides may exceed
> $300 per copy." (SDE manual, PDF pp.134–135, printed pp.8-12/8-13)

The manual does **not** name a specific product. Static inspection of the SDE
3.0 desktop tool's installer (downloaded directly from
`https://www.fema.gov/sites/default/files/2020-07/SDE3_04062018.zip`,
SHA-256 `6e1f7d9a225936460ab541e2f28901102ff8b432741a614b74a1b0ec73e86cb4`,
extracted via `msiexec /a` administrative extraction — no install, no
execution) confirmed the shipped Access database (`SDEDatabase.mdb`) and JSON
payload contain **zero populated dollar-cost rows** — the tool ships a
`BaseCostPerSqFt` / `BaseCost` / `CostDataRef` field for a human to fill in,
not a bundled cost table. See `docs/data-contracts/sde-tool-inspection.md`
for the full account (status: **STILL BLOCKED** on unit-cost dollar figures,
though the download/extraction/inspection itself succeeded and is fully
documented there — an earlier draft of that companion document, produced by
a separate concurrent process that hit a transient `fema.gov` 403, incorrectly
reported the download as failed; that has been corrected in the file itself,
and the successfully downloaded/extracted files remain on disk at
`data/raw/SDE3_04062018.zip` and `data/raw/sde_tool_extracted/` as evidence).

## Options considered

### Option A — ICC (International Code Council) Building Valuation Data (BVD)

- **What it is:** A twice-yearly published table of $/sq-ft construction cost
  by IBC occupancy group × construction type, used nationally by building
  departments to set permit valuations/fees.
- **Source naming it for this exact SI/SD use case:** Town of Bethany Beach,
  DE "SI/SD Administrative Procedures"
  (`https://townofbethanybeach.com/DocumentCenter/View/7316/SI-SD-Administrative-Procedures`)
  states repair/improvement cost is determined by "itemized costs, building
  valuation tables, qualified estimates, owner-prepared cost estimates with
  supporting documentation, or FEMA's Substantial Damage Estimator software,"
  and that "Local communities use the International Code Council – Building
  Valuation Data to determine a value of repair based on building types and
  square footage of damaged properties" (per search-result summary of that
  document; the PDF itself could not be text-extracted directly — it appears
  to be a scanned/image PDF — so this specific quote is sourced from the
  search engine's indexed summary of the document, not a direct page read; a
  human should re-fetch and manually confirm the exact sentence before relying
  on it as a citation).
- **Official ICC source page:** `https://www.iccsafe.org/products-and-services/i-codes/code-development-process/building-valuation-data/`
  — this page states "Only registered ICC members have access to this article
  at this time," i.e. ICC gates the *article/methodology page* behind free
  ICC membership signup.
- **Actual table, directly read:** The current BVD table ("Effective
  01/01/2025 - 5% increase") is openly re-published as a PDF by multiple
  county/city governments and was fetched and read directly in this pass —
  e.g. Contra Costa County, CA:
  `https://www.contracosta.ca.gov/DocumentCenter/View/75978/ICC-Building-Valuation-Data-PDF`
  (fetched 2026-08-17). Verbatim sample row read directly from that PDF:
  `R-3 Residential, one- and two-family: 183.17 / 178.10 / 173.71 / 169.13 /
  162.91 / 158.69 / 163.92 / 152.67 / 143.66` ($/sq ft, by IBC construction
  type IA through VB). A second sheet in the same PDF gives "Commercial Shell
  Buildings" rates.
- **Underlying data source:** per search results, "The BVD table was compiled
  by ICC using the Marshall Valuation Service as published by the Marshall
  and Swift Publication Company" — i.e. ICC BVD is itself a derivative
  publication of Marshall & Swift data (see Option B), republished by ICC as
  national-average figures.
- **Regional adjustment:** ICC's own methodology (per search-result summary)
  calls for applying a "Regional Cost Modifier" to the national base table;
  the modifier table itself and its Indiana/Hamilton-County-specific value
  were **not independently located or verified in this pass** — flag as a
  required follow-up before using BVD figures for Hamilton County without
  adjustment.
- **SERIOUS CAVEAT, directly verified from the downloaded PDF itself**
  (`data/raw/icc_bvd_aug2025.pdf` / `.txt`, "Important Points" section):
  > "The BVD is not intended to apply to alterations or repairs to existing
  > buildings. Because the scope of alterations or repairs to an existing
  > building varies so greatly, the Square Foot Construction Costs table does
  > not reflect accurate values for that purpose."
  This is exactly the use case RiverLine needs (costing repair of flood-damaged
  existing structures for the 50%-rule ratio), not new construction or permit-fee
  valuation, which is what BVD is designed for. ICC's own document only carves
  out one exception — additions that are essentially stand-alone new
  construction attached to an existing building — which does not cover
  general flood-damage repair costing. **This does not necessarily disqualify
  BVD** (FEMA's own manual lists "cost-estimating guides" generically and SDE
  practice commonly adapts new-construction guides for this purpose via the
  element/depreciation framework already documented in `sde-cost-tables.md`),
  but a human evaluating this option must weigh this explicit vendor caveat
  against how FEMA-experienced floodplain administrators actually apply BVD
  in SI/SD determinations — this was not resolved in this pass.
- **Cost / access:** Effectively free in practice — the current table is
  openly re-published by many county governments as a plain PDF (found for
  Fruita CO, Contra Costa CA, Kitsap WA, Dagsboro DE, San Diego CA in this
  pass); no paywall was hit fetching the Contra Costa PDF directly.
- **Format / machine-readability:** PDF table (not a structured export);
  values are plain text and were extracted programmatically with
  `pdfplumber` in this pass with no special tooling — straightforward to
  parse into a machine-readable table, but not delivered as CSV/JSON/API by
  ICC itself.
- **Licensing / redistribution:** No explicit copyright/license or
  redistribution-prohibition text was found on the pages fetched in this pass
  (neither on ICC's own gated page nor on the county-republished PDFs). This
  is a **gap, not a confirmed "free to redistribute" finding** — a human
  should check ICC's terms of use directly (the ICC BVD "article" access page
  requires a free member login, which was not created in this pass) before
  embedding BVD figures into RiverLine's shipped software or database.

### Option B — Marshall & Swift / CoreLogic "SwiftEstimator"

- **What it is:** The named underlying data source behind ICC BVD (see
  above) — a paid, subscription/pay-per-report residential and commercial
  cost estimating service, now sold by CoreLogic under the Marshall & Swift
  brand.
- **Official URL:** `https://www.corelogic.com/mortgage/appraiser-solutions/marshall-swift/`
  (product landing page) and `https://www.swiftestimator.com/` (the ordering
  tool).
- **Pricing:** SwiftEstimator's signup page
  (`https://www.swiftestimator.com/SIGNUP/Plans.aspx`, fetched 2026-08-17)
  states: "The only plan currently available for SwiftEstimator is a
  Pay-As-You-Go Plan. Under this plan, your credit card will automatically be
  charged after each session." **The exact per-session dollar price was not
  disclosed on the page fetched — a sales/pricing quote would be required.**
  This is consistent with the SDE manual's own note that guide copies "may
  exceed $300 per copy."
- **Format:** Web-based report generator (SwiftEstimator), i.e. per-property
  reports, not a bulk downloadable dataset.
- **Licensing / redistribution — SERIOUS CONSTRAINT, directly verified:** The
  SwiftEstimator license terms
  (`https://swiftestimator.com/Signup/License.aspx`, fetched 2026-08-17)
  state, verbatim per direct fetch:
  > "Use of the information, calculations, products or services provided
  > through SwiftEstimator for resale or for any use other than Your direct
  > personal or internal business needs is prohibited."

  > "rent, sell, lease, sublicense, assign, transfer, lend, give, modify,
  > translate, time-share, publish, electronically transmit or receive or
  > otherwise convey or permit access to the Software or Publication"

  > "use and/or integrate a third party computer program...with the Software
  > or Publication...without the prior written consent of MSB and payment of
  > applicable fees"

  > "develop a database, data compilation, data set or other data grouping
  > containing the Software, Publication or MSB Data or MSB Proprietary
  > Information"

  **This license would forbid exactly what RiverLine needs to do** — pull a
  base-cost figure into `cost_tables.json_payload` and persist/redistribute it
  inside the application's own database. If Hamilton County licenses Marshall
  & Swift / SwiftEstimator, a human must confirm in writing with CoreLogic
  that per-determination cost figures may be stored and used inside RiverLine,
  or the county must re-enter/re-derive figures manually per use in a way
  that does not "develop a database... containing... MSB Data."

### Option C — Other guides referenced only generically in search results (NOT independently source-verified — do not use these names without direct verification)

A search summary (not a directly fetched primary source) mentioned "RSMeans,
BNi Costbooks, Marshall & Swift, and Sweet's Unit Cost Guide" as products
FEMA "recognizes" for cost estimation more broadly (construction/public
assistance costing, not specifically SI/SD residential base-cost guides).
**This claim came from an AI-generated search summary, not a page this agent
fetched and read directly, and is therefore NOT a verified fact per this
project's sourcing rule.** RSMeans (Gordian) and BNi/Sweet's were not
independently fetched or priced in this pass. If the county is interested in
these, a human must fetch their official pricing/licensing pages directly
before this ADR can cite them as options.

### Option D — Local building-permit valuation data (free, defensible, but not independently priced)

FEMA's own guidance quoted above explicitly lists "community estimates from
local building and repair permits" as an acceptable base-cost source — this
is not a product, but the community's own historical permit-valuation
records. Hamilton County's own permit-valuation figures for Noblesville were
searched for in this pass but **NOT found** — no public $/sq-ft table
specific to Hamilton County or Noblesville was located; only generic
third-party permit-cost-estimate marketing pages (uspermits.org,
jaspector.com, tmgroupdc.com — none of these are official sources and none
were used for any figure in this ADR). A human would need to contact
Noblesville's Building & Inspections department directly (contact verified
in `docs/data-contracts/contacts.md`) to determine whether the city maintains
its own valuation table.

## Tradeoffs

| | ICC BVD | Marshall & Swift / SwiftEstimator | Local permit data |
|---|---|---|---|
| Cost | Effectively free (openly re-published by many counties as PDF) | Paid, per-session, exact price requires sales quote | Free, but must be independently sourced/negotiated with the city |
| Machine-readability | PDF table, parseable (demonstrated with `pdfplumber` in this pass) | Web report only, not a bulk dataset | Unknown — not located |
| Redistribution / embedding in RiverLine's DB | No explicit prohibition found (but not confirmed permitted either — real gap) | **Explicitly prohibited** without CoreLogic's written consent and additional fees | No third-party license risk (it would be the county's own data) |
| Regional accuracy for Hamilton County | National base table + a "Regional Cost Modifier" whose Hamilton-County-specific value is NOT yet located | Presumably localized (CoreLogic's core value proposition) but not confirmed in this pass | Most locally accurate by construction, if it exists |
| Currently used anywhere in NFIP/SI-SD practice per a verified source | Yes — Bethany Beach, DE SI/SD procedure names it (see caveat on that source's own extractability above) | Named only as ICC BVD's underlying data compiler, not independently confirmed as directly used by any community for SI/SD in this pass | Named generically by FEMA's own manual, not a specific product |
| Vendor's own stated intended use | **ICC's own PDF states BVD "is not intended to apply to alterations or repairs to existing buildings"** — the exact fact pattern of SI/SD repair costing (see caveat above, directly quoted from `data/raw/icc_bvd_aug2025.pdf`) | Not checked in this pass | N/A — it would be the actual repair cost, by construction |

**Two risks found in this research pass, roughly comparable in severity:**
1. If Hamilton County already licenses or is considering Marshall & Swift/CoreLogic
   data (directly, or indirectly through some other ICC-adjacent product with
   similar terms), the license as fetched in this pass would prohibit storing
   per-determination cost figures inside RiverLine's database at all. This must be
   checked before any integration design assumes a licensed guide's figures can be
   persisted.
2. ICC BVD's own document disclaims applicability to exactly the repair/alteration
   use case this project needs it for. Selecting BVD without addressing this
   directly (e.g. confirming how other FEMA SI/SD communities reconcile this with
   their use of BVD, or applying a documented adjustment methodology) risks a
   legally consequential determination built on a cost source the publisher itself
   says is inaccurate for the purpose.

## Decision: PENDING — human must select

This ADR does not select a cost-estimating guide. Selection requires:
1. A procurement/budget decision (guide subscription cost vs. free
   ICC-republished BVD table vs. building city-specific permit data).
2. A license review — specifically, written confirmation from any paid
   vendor (e.g. CoreLogic) that per-determination cost figures may be stored
   in RiverLine's database, given the restrictive language found in Option B
   above.
3. Confirmation of the ICC BVD Regional Cost Modifier value applicable to
   Hamilton County, Indiana (not located in this pass), if Option A is
   selected.
4. Legal/assessor sign-off, since this figure feeds a legally consequential
   substantial-damage determination.

None of these four items can be completed by a research agent. A human
(project owner, county floodplain administrator, and/or legal counsel) must
make this selection and record it as a decision in this ADR before M3
(50%-rule engine) implementation proceeds with any real cost figures.
