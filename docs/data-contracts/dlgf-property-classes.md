---
# Indiana DLGF — Property Class Codes ("Code List 1")
**Status:** VERIFIED — official code table found, downloaded, and cross-checked exactly against real Hamilton County parcel data
**Primary source URL:** https://www.in.gov/dlgf/files/2026-memos/Property-Tax-Management-System-Code-List-Manual-260514.pdf
**Retrieved:** 2026-08-17
**Retrieved by:** research agent
**License / terms:** Not stated on the document itself (no license/copyright notice found in extracted text). It is an Indiana state government administrative publication (Department of Local Government Finance, "Property Tax Management System Code List Manual," dated May 27, 2026). Treat as a public state administrative document; no explicit open-data license string found — same caveat as other state/county sources in this project.

## How to obtain
```
curl -L "https://www.in.gov/dlgf/files/2026-memos/Property-Tax-Management-System-Code-List-Manual-260514.pdf" -o data/raw/dlgf_code_list_manual_260514.pdf
pdftotext -layout data/raw/dlgf_code_list_manual_260514.pdf data/raw/dlgf_code_list_manual_260514.txt
```
Downloaded successfully 2026-08-17. File details:
- Path: `data/raw/dlgf_code_list_manual_260514.pdf`
- Size: 1,846,228 bytes
- SHA-256: `37b3d618ae996f1aff78717ac017df2911e2fb0fbf32943b52b930dc4335608d`
- 124 pages total. "Code List 1 – Property Class Codes" is on printed pages 2–7 (this is the table applied to the `PARCEL` table's `Property Class Code` field per the document itself — the exact field Hamilton County's `PROPCLASS` is sourced from). "Code List 2 – Street Codes" begins immediately after, on printed page 7.
- Extracted text saved at `data/raw/dlgf_code_list_manual_260514.txt`.

This document was found via web search for DLGF property class code resources; other DLGF documents that also reference or restate this same code list (not independently re-verified in this pass, listed for a human's awareness):
- 2021 Real Property Assessment Manual — https://www.in.gov/dlgf/files/2021-assessment-guidelines/Assessment-Manual.pdf (search results describe a Table A-1 "Property Class Codes" / Table A-2 "Property Subclass Codes" in this manual; not opened in this pass)
- Tippecanoe County's own published summary page — https://www.tippecanoe.in.gov/157/Property-Class-Codes (a county secondary source, not opened in this pass; listed only as a lead, not used as a citation)

## Observed fields (verbatim from source, Code List 1)
The table below is the **full three-digit code → value list** as printed in the source document, extracted with `pdftotext -layout`. A handful of entries whose description text wraps across a page/line break came out of the raw extraction with the code number and value on visually separated lines (`pdftotext -layout` artifact — the underlying PDF table itself is not corrupted, only the plain-text re-flow is ambiguous in a few spots, mostly in the 500s "unplatted land" residential subcategories and the 800s utility-company subcategories). Codes actually present in Hamilton County sample data (100, 101, 425 — see Sample below) are unambiguous and confirmed exact-string matches against the source PDF.

| Code range | Category (as headed/grouped in source) |
|---|---|
| 100–199 | Agricultural (100 = vacant land; 101 = cash grain/general farm; 102 = livestock other than dairy/poultry; 103 = dairy farm; 104 = poultry farm; 105 = fruit & nut farm; 106 = vegetable farm; 107 = tobacco farm; 108 = nursery; 109 = greenhouses; 110 = hog farm; 111 = beef farm; 120 = timber; 141/149 = agricultural land with mobile home; 198/199 = other agricultural use) |
| 200 | Mineral |
| 300–398 | Industrial (300 = vacant land; 310 = foundries & heavy manufacturing; 320 = medium manufacturing & assembly; 330 = light manufacturing & assembly; 340 = office; 345 = R&D facility; 346 = warehouse; 350 = truck terminals; 360 = small shops; 370 = mines and quarries; 380 = landfill; 385 = grain elevators; 390 = building on leased land; 398 = other structures) |
| 399–498 | Commercial (399 = vacant land; 400/401/402 = 4-19 / 20-39 / 40+ family apartments; 409 = motels/tourist cabins/hotels; 410 = nursing homes & hospitals; 411 = mobile home parks; 420 = small retail; 421 = supermarkets; 422 = discount & junior department stores; 424 = full line department stores; **425 = neighborhood shopping center**; 426 = community shopping center; 427 = regional shopping center; 430/431/435 = restaurants; 440 = dry clean/laundry; 441 = funeral home; 442 = medical clinic/offices; 443/444/445 = banks/savings & loans; 447/448/449 = office buildings; 450/451/452/453/454/455/456 = auto/gas/parking/theater uses; 462 = golf course; 463 = bowling alley; 466 = health club; 469 = warehouse; 480 = mini-warehouse; 490/495 = marina; 498 = other structure) |
| 499–599 | Residential (499 = vacant platted lot; 500–505 = vacant unplatted land by acreage tier; 511–520 = one-family dwelling, platted/unplatted by acreage tier; 521–531 = two-family dwelling; 532–540 = three-family dwelling; 541–551 = mobile/manufactured home dwelling; 552–558 = condominium unit dwelling; 590/591 = condominiums / PP mobile home; 598 = residential on leased land; 599 = residential other structures) |
| 600–699 | Exempt property (owned by federal/state/county/township/municipal/school/park/library/religious/charitable entities; 699 = locally assessed vacant utility land–commercial, grouped adjacent to exempt codes in the source table) |
| 800–89x | State/locally assessed utility company property (bus, light/heat/power, pipeline, railroad, sewage, telephone/telegraph/cable, water distribution companies — each split into "commercial" / "industrial" / state-assessed subcodes) |

**Exact codes confirmed present in `data/raw/hamco_parcels_sample3.json`** (verbatim string match against the source PDF text):
| PROPCLASS | DLGF source value (verbatim) | Hamilton County PROPUSE (sample) | Match |
|---|---|---|---|
| "100" | AGRICULTURAL - VACANT LAND | "Ag - Vacant lot" | exact category match |
| "101" | AGRICULTURAL - CASH GRAIN/GENERAL FARM | "Cash grain/general farm" | **exact verbatim match** (case/hyphenation aside) |
| "425" | COMMERCIAL NEIGHBORHOOD SHOPPING CENTER | "Neighborhood shopping center" | **exact verbatim match** |

This exact-string match (down to the specific phrase "cash grain/general farm" and "neighborhood shopping center") confirms Hamilton County's `PROPUSE` field is populated directly from this same DLGF Code List 1 table (title-cased), not an independent local taxonomy. The county's ArcGIS layer metadata (`data/raw/hamco_parcels_layer0_meta.json`) confirms `PROPCLASS` has no `domain` (coded-value list) attached at the service level — the mapping lives only in this DLGF document, not in the service's self-describing metadata.

## Sample
See table above — no separate sample needed beyond the 3 confirmed rows; full PROPCLASS/PROPUSE pairs are in `data/raw/hamco_parcels_sample3.json`.

## Residential vs. non-residential branch signal — verdict
**PROPCLASS is a sufficient and clean signal for the residential/non-residential SDE branch, and is preferable to PROPUSE or sq_ft_res/sq_ft_comm as the primary determinant, with one caveat below.**

Reasoning:
1. The code ranges are cleanly partitioned by design: 499–599 is the entire residential range (1–3 family dwellings, mobile/manufactured homes, condos, residential vacant land). Everything else (100–498, 600–89x) is agricultural, industrial, commercial, mineral, exempt, or utility — i.e., non-residential in FEMA SDE terms. A single numeric range check (`499 <= code <= 599`) is simpler and more robust than string-matching `PROPUSE` free text (which is a human/software-generated label from the same table, not a boolean flag, and could theoretically drift in casing/wording from the code).
2. `PROPUSE` is *derived from* `PROPCLASS` (per the exact-match evidence above), so it carries no additional information for this branch decision — using it as the primary signal would just be indirecting through the same table this contract already documents, with more string-parsing risk.
3. `sq_ft_res` / `sq_ft_comm` are **not** reliable branch signals on their own: per `hamilton-county-parcels.md` Gap #4, both are frequently `null` (e.g. any vacant parcel), and a parcel can plausibly have both populated (mixed-use). They describe *area*, not *occupancy classification*, and Indiana's own classification system (this code list) is the authoritative occupancy signal FEMA SDE implicitly expects ("residential" vs. "non-residential" structure).
4. **Caveat:** codes 400–402 (4-19 / 20-39 / 40+ family apartments) are classified by DLGF as **Commercial**, not Residential, even though apartment buildings are physically dwellings. A human/spec decision is needed on whether multi-family apartment buildings should route through the SDE's 12-element residential branch or the 7-element non-residential branch — FEMA SDE's own definition of "residential" vs. "non-residential" (in `sde-cost-tables.md`) was not cross-checked against DLGF's commercial/residential split in this pass. **Do not assume DLGF's 400-range → SDE's residential branch mapping is correct without checking the SDE manual's occupancy definitions directly.** Similarly, 541–551 mobile/manufactured home codes and 552–558 condo codes fall inside the 499–599 residential range and should map cleanly to SDE-residential, but this has not been independently confirmed against SDE manual language either.

**Recommendation:** use `499 <= int(PROPCLASS) <= 599` (excluding any codes DLGF classifies as commercial apartments, per the caveat above) as the primary branch signal, falling back to manual/official override when `PROPCLASS` is null or ambiguous — consistent with the project's existing official-override pattern for other ambiguous fields.

## Gaps and risks
1. `pdftotext -layout` extraction has line-wrap ambiguity in a handful of multi-line entries (mostly the 500s unplatted-acreage-tier residential codes and 800s utility-company codes, where a long description wraps to a second line and the following code number visually shifts up a row in the plain-text reflow). The codes actually needed for this project (100, 101, 425, and the 499–599 residential range boundary) are unambiguous. If a specific code beyond these is needed later, re-extract with a PDF table-extraction tool (e.g. `camelot`/`tabula`) rather than trusting the plain-text reflow for the ambiguous rows, or open the PDF directly.
2. The apartment-code caveat above (DLGF commercial 400–402 vs. SDE residential/non-residential branch) is unresolved — flagged as a specific open question for whoever implements the 50%-rule branch logic.
3. No independent confirmation that this "Property Tax Management System Code List Manual" (dated 2026-05-27, i.e. very recent) is the version currently governing Hamilton County's live PROPCLASS field vs. some prior-year version — though the exact string matches found (100, 101, 425) strongly suggest current alignment. If DLGF revises code meanings in a future edition, Hamilton County's live data and this document could drift; no versioning field ties a specific parcel record to a specific code-list edition.
4. Property **subclass** codes (Table A-2 in the 2021 Real Property Assessment Manual, per search result) were not retrieved or verified in this pass — only the primary 3-digit Property Class code was in scope, matching the `PROPCLASS` field's actual length (3 chars) in Hamilton County's schema.

## Unverified claims
- Whether DLGF's 400–402 "commercial" apartment codes should route to the FEMA SDE residential (12-element) or non-residential (7-element) branch — NOT checked against SDE manual occupancy-definition language in this pass.
- Whether the 2021 Real Property Assessment Manual's Table A-1/A-2 exactly duplicates this Code List Manual's Code List 1, or differs in any way — NOT independently fetched/compared in this pass.
- Whether Hamilton County's live ArcGIS FeatureServer is actually driven by this exact May-2026 manual edition versus an older one — inferred from exact-string matches on 3 sample codes, not confirmed by the county directly.
