---
# FEMA SDE 3.0 — Element Structure and Cost Tables
**Status:** PARTIAL — element/component breakdown VERIFIED with page citations; unit-cost dollar figures BLOCKED (do not exist in the retrieved source document)
**Primary source URL:** https://www.fema.gov/sites/default/files/2020-07/sde_3.0_user_manual_field_workbook_0.pdf
**Retrieved:** 2026-08-17
**Retrieved by:** research agent
**License / terms:** FEMA public document (FEMA P-784, August 2017). Public-domain U.S. Government work; no restrictive license found in the document.

## How to obtain
```
curl -L "https://www.fema.gov/sites/default/files/2020-07/sde_3.0_user_manual_field_workbook_0.pdf" -o data/raw/sde_3.0_user_manual_field_workbook.pdf
```
Downloaded successfully 2026-08-17. File details:
- Path: `data/raw/sde_3.0_user_manual_field_workbook.pdf`
- Size: 8,237,968 bytes
- SHA-256: `71a2dfc9d748fc343205fd3ef1f44e9a353c70a28b781982b78663fdc517356f`
- 244 pages total (Section 1–5 = "SDE 3.0 User Manual"; Section 6–11 + Appendices A–F = "SDE 3.0 Field Workbook", same PDF)
- FEMA also lists the tool itself at https://www.fema.gov/emergency-managers/risk-management/building-science/substantial-damage-estimator-tool (the installable SDE 3.0 desktop application; NOT downloaded in this pass — it is a Windows application installer, not a document, and was out of scope for a document-retrieval pass. A human should evaluate whether the application's internal cost database is a usable machine-readable source — see Gaps below).

## Observed fields (element/component structure — VERIFIED, with page citations)

**CRITICAL FINDING for the build spec:** `docs/riverline-sdd-build-spec.md` §4 lists the element structure as 8 items ("foundation, superstructure, roof, interior finish, electrical, plumbing, HVAC, built-in appliances"). **The actual SDE 3.0 structure has 12 elements for residential and 7 for non-residential, and they do not map one-to-one to the spec's list.** This must be corrected before A3/M3 implementation, or SDE import will not match.

### Residential — 12 elements (Table 3-6, PDF p.65–67, printed pages 3-39 to 3-41)
| # | Element | Components (quoted) |
|---|---|---|
| 1 | Foundations | Continuous perimeter footings; Footings; Piers; Foundation-level components not included in other elements |
| 2 | Superstructure | Wall support system extending from the foundation wall to the roof structure; Exterior wall; Sheathing panels; Shear panels; Bracing panels; Structural members that support the roof deck (rafters and trusses, not roof sheathing) |
| 3 | Roof covering | Covering material (shingles, tile, slate, metal roofing, built-up roofing); Roof sheathing; Roof flashing; excludes structural framing members supporting the roof deck |
| 4 | Exterior finish | Wall covering system on top of wall sheathing (stucco, vinyl/wood siding, brick veneer, stone veneer); Insulation and weather stripping |
| 5 | Interior finish | Gypsum board, drywall, plaster, or paneling (wall/ceiling surfaces); Trim around door/window frames; Baseboard; Casings; Chair rails; Ceiling moldings |
| 6 | Doors and windows | All interior and exterior doors and windows; Locks; Hinges; Frames; Handles |
| 7 | Cabinets and countertops | Built-in, wall-mounted, or isolated cabinets and countertops (kitchens and bathrooms) |
| 8 | Floor finish | Carpet; Hardwood; Vinyl composition tile; Sheet vinyl; Ceramic tile; Marble; excludes carpet/re-carpeting installed over finished flooring |
| 9 | Plumbing | Incoming water service; Plumbing fixtures; Water heater; Water distribution system; Wastewater collection and removal system |
| 10 | Electrical | Electrical wiring systems (junction boxes, circuit breaker panels, distribution wiring, outlets, switches, receptacles); Lighting; Ceiling and exhaust fans; Electric baseboard heaters |
| 11 | Appliances | All built-in, permanent appliances in the structure |
| 12 | HVAC | System distributing conditioned air (typically forced-air with duct work); Exterior AC units; Heat pumps; Furnaces |

Source: PDF pages 65–67 (`pdftotext`/`fitz` page index 64–66, 0-based), printed page numbers 3-39, 3-40, 3-41. Extracted text saved at `data/raw/sde_pages_59-68.txt`.

### Non-residential — 7 elements (Table 3-8, PDF p.77, printed page 3-51)
| # | Element | Components (quoted) |
|---|---|---|
| 1 | Foundations | Continuous perimeter footings; Footings; Piers; All foundation elements |
| 2 | Superstructure | Load-bearing system foundation-to-roof (excl. foundation); structural members supporting roof deck (excl. sheathing); exterior finishes (walls, siding, exterior doors) |
| 3 | Roof covering | Covering material; Roof sheathing; Roof flashing; excludes structural framing |
| 4 | Plumbing | Incoming water service; Plumbing fixtures; Water heater; Water distribution; Wastewater collection/removal; Exterior drainage (gutters, downspouts); Fire protection |
| 5 | Electrical | Wiring systems; Lighting; Ceiling/exhaust fans; Electric baseboard heaters; Communications; Conveyance (escalators, elevators); Security systems |
| 6 | Interiors | Partitions; Interior doors; Interior surface finishes (wall/floor/ceiling) |
| 7 | HVAC | Heating units; Cooling units; Ventilation |

Source: PDF page 77 (0-based index 76), printed page 3-51.

### Depreciation rating table — 6-point scale (Table 3-5, PDF p.63–64, printed pages 3-37/3-38) — VERIFIED, real percentages, cite before use
| Rating | Description (quoted) | Depreciation value |
|---|---|---|
| 1 | Very Poor Condition — dilapidated, deteriorating, uninhabitable, likely abandoned | 88.9% |
| 2 | Requires Extensive Repairs — inhabitable but needs extensive repair/maintenance | 66.5% |
| 3 | Requires Some Repairs | 38.8% |
| 4 | Average Condition — normal wear, no major repair signs | 24.2% |
| 5 | Above Average Condition — little visible wear, not "brand new" | 13.4% |
| 6 | Excellent Condition — ≤2 years old, no visible deterioration | 2.9% |
| Other | Determined by inspector, reason required | user-defined |

This is a real, citable table from the retrieved document (PDF pp.63–64 / printed 3-37 to 3-38, `data/raw/sde_pages_59-68.txt`). This is a *depreciation* schedule (used to compute Actual Cash Value), not a per-element *unit cost* table.

## Gaps and risks — unit-cost dollar values: BLOCKED, explicit reason
**No dollar-denominated unit-cost table exists in this document.** The manual explicitly and repeatedly states that base cost per square foot must come from an external source the community selects — it is NOT published inside SDE or its manual:

> "The base cost can be obtained from an industry-accepted, residential cost-estimating guide, contractor's estimates, and community estimates from local building and repair permits, or professional appraisers." (PDF p.62, printed p.3-36)

> "Sources of base cost data include: Industry-accepted, residential or non-residential cost-estimating guides; Local permit data...; Professional experience by a community official... the price of the guides may exceed $300 per copy." (PDF p.134–135, printed pp.8-12/8-13)

No specific guide is named in the manual (no product/publisher name appears in the extracted text of these sections). **Do not infer or guess a cost-guide name or dollar figures from general knowledge.**

**What a human must do to obtain unit costs:**
1. Decide which "industry-accepted, residential/non-residential cost-estimating guide" Hamilton County / Noblesville will use (the manual references this class of product generically, e.g. paid national cost-estimating databases; it does not name one, and this agent will not name one from memory).
2. Obtain that guide's current base-cost-per-square-foot tables and geographic adjustment factor for the Hamilton County / Noblesville, IN market.
3. Alternatively, install the actual SDE 3.0 desktop tool (link above) and inspect whether it ships with a bundled default cost database — this was NOT evaluated in this pass since it requires installing a Windows application, which is out of scope for a document/data-contract research pass. A human should verify this specifically; if the tool does ship default costs, that would be the authoritative machine-extractable source and should get its own data-contract entry with page/screen citations.
4. Record the resulting `$/sqft` figures, source name, and publication date directly into `cost_tables.json_payload` per build spec §4.3, each figure carrying its source citation — never write a number here without that citation.

## Unverified claims
- Whether the installable SDE 3.0 desktop tool bundles a default/example cost database was not checked (would require installing Windows software, out of scope for this pass).
- Whether a newer SDE version postdates 3.0 (August 2017) was not checked beyond the search results, which showed no successor version.
- FEMA P-784 is CONFIRMED as the publication number — found verbatim on the cover page of the retrieved PDF ("FEMA P-784 / Tool Version 3.0 / August 2017") and referenced throughout (`data/raw/sde_3.0_extracted.txt`). The related desk-reference document FEMA P-758 ("Substantial Improvement/Substantial Damage Desk Reference," 2010) is cited repeatedly inside this document as a companion resource but was NOT separately retrieved in this pass — a human should fetch it directly if the project needs its content (e.g. the assessed-vs-market-value guidance referenced in build spec §4.1).
