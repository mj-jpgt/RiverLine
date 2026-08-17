# Data contracts — status summary

Retrieved 2026-08-17 by research agent. Each row links to the full contract with exact endpoints, verified field names, verbatim sample rows, and citations. Raw retrieved artifacts are in `data/raw/` (gitignored).

| dataset | status | blocker |
|---|---|---|
| [Hamilton County parcels + assessor values](./hamilton-county-parcels.md) | VERIFIED (schema/samples) / PARTIAL (value semantics) | No dedicated "market value" field exists — only `AVLAND`/`AVIMPROVE`/`AVTOTGROSS` (assessed values). Requires human/legal confirmation of assessed-vs-market-value equivalence, or reliance on the official override + appraisal path already specified in the build spec. Also: `PROPCLASS` code table (Indiana DLGF) not yet retrieved. |
| [FEMA NFHL / effective FIRM SFHA layer](./fema-nfhl.md) | VERIFIED | None blocking — live REST endpoint confirmed, Hamilton County `DFIRM_ID='18057C'` confirmed, `FLD_ZONE`/`SFHA_TF` fields confirmed. Minor open item: BFE population near White River/Noblesville not spot-checked. |
| [FEMA SDE 3.0 element structure and cost tables](./sde-cost-tables.md) | PARTIAL — structure VERIFIED, unit costs BLOCKED | FEMA's SDE manual (P-784, downloaded and verified) explicitly does NOT publish unit-cost dollar tables — communities must supply their own from an external, unnamed "industry-accepted cost-estimating guide." A human must select and obtain that guide. Also found: the real element structure is 12 residential / 7 non-residential elements, not the 8-item list currently in the build spec — spec needs correcting. |
| [USGS FIM — Noblesville / White River](./usgs-fim-noblesville.md) | VERIFIED (metadata) | Depth-grid archive (79 MB) located and its exact download URL/size confirmed but not downloaded/unzipped in this pass; internal raster format and projection not yet inspected. |
| [Noblesville / Hamilton County floodplain ordinance](./ordinance-citations.md) | BLOCKED | Primary-source host (codelibrary.amlegal.com) is behind Cloudflare bot-protection; both WebFetch and curl returned HTTP 403. Candidate section citations (§159.016, §159.109) identified but not read. A human must open the pages in a real browser and transcribe verbatim text. |

## Single most important finding
The build spec's assumed SDE element list (8 items) does not match the real SDE 3.0 structure (12 residential / 7 non-residential elements) — see `sde-cost-tables.md`. This affects the M3 50%-rule engine's data model directly and should be corrected before implementation, not discovered later during an SDE export/import mismatch.

## What a human must do next (complete list)
1. Select and obtain a licensed cost-estimating guide (or confirm the SDE 3.0 desktop tool's bundled cost database) to populate `cost_tables.json_payload` unit costs — see `sde-cost-tables.md` Gaps section.
2. Obtain the Indiana DLGF property-class code table to map Hamilton County parcels' `PROPCLASS` values to occupancy/use categories.
3. Confirm with Hamilton County Assessor (or legal counsel) whether `AVTOTGROSS` may be treated as "market value" per FEMA P-758 guidance, or whether every determination must default to the appraisal-override path.
4. Open codelibrary.amlegal.com/codes/noblesville in a real browser (Cloudflare blocks automated fetches) and transcribe the verbatim floodplain/SFHA overlay district and substantial-damage/substantial-improvement definition sections, with exact `§` citations, into `ordinance-citations.md`.
5. Confirm whether Hamilton County (the county government) has its own separate floodplain ordinance distinct from Noblesville's, and which jurisdiction(s) RiverLine's initial deployment actually needs.
6. Download and unzip the USGS depth-grid archive (`usgs-fim-noblesville.md` → How to obtain) to confirm internal file format, per-stage naming, and projection before writing `scripts/preprocess/` ingest code.
7. Decide whether to build against the live Hamilton County / FEMA NFHL REST services at preprocessing time, or pull a packaged/versioned snapshot (e.g. FEMA MSC county download) for reproducibility — not evaluated in this pass.
