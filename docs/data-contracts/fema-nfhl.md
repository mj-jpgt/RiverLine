---
# FEMA NFHL / Effective FIRM SFHA layer
**Status:** VERIFIED
**Primary source URL:** https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer
**Retrieved:** 2026-08-17
**Retrieved by:** research agent
**License / terms:** FEMA public data; general FEMA.gov terms of use apply (public domain U.S. Government work). Not independently re-fetched from a dedicated terms page in this pass — treat license text itself as UNKNOWN pending a human pulling the exact statement from fema.gov, but the data is federal public-domain geospatial data served for public consumption via this REST endpoint.

## How to obtain
Live ArcGIS REST MapServer, no login required (confirmed 2026-08-17):

```
# Service-level layer catalog
curl "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer?f=json"

# Layer 28 = Flood Hazard Zones — metadata
curl "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28?f=json"

# Layer 28 filtered to Hamilton County, IN by DFIRM_ID (county FIRM database ID)
curl "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?where=DFIRM_ID=%2718057C%27&outFields=*&f=json"

# Layer 3 = FIRM Panels, same DFIRM_ID filter
curl "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/3/query?where=DFIRM_ID=%2718057C%27&outFields=*&f=json"

# Layer 22 = Political Jurisdictions — used to discover the DFIRM_ID/CID for a county
curl "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/22/query?where=ST_FIPS=%2718%27%20AND%20CO_FIPS=%27057%27&outFields=*&f=json"
```

There is also a public-facing FEMA Flood Map Service Center (MSC) NFHL county-download product referenced from https://www.fema.gov/flood-maps/national-flood-hazard-layer — that packaged county download was NOT independently fetched in this pass (search-result lead only); the REST service above was queried directly and is the verified source for this contract.

**Hamilton County, Indiana identifiers (verified by direct query, 2026-08-17):**
- `DFIRM_ID = "18057C"` (confirmed via layer 22 query `ST_FIPS='18' AND CO_FIPS='057'` → 189 features returned, `POL_NAME1 = "HAMILTON COUNTY"`, `CID = "180080"`, `COMM_NO = "0080"`)
- Use `DFIRM_ID = '18057C'` as the filter for all NFHL layers (zones, panels, BFE lines, etc.) to scope to Hamilton County.
- Layer 28 (Flood Hazard Zones) record count within Hamilton County: **4,670** features (`returnCountOnly=true` with `DFIRM_ID='18057C'`).

**Coordinate system:** `wkid 4269` (NAD83 geographic, decimal degrees) at the service level.

## Observed fields

### Layer 28 — "Flood Hazard Zones" (polygon; use for SFHA determination)
| field | type | example value | notes |
|---|---|---|---|
| DFIRM_ID | esriFieldTypeString | "18057C" | county FIRM database ID |
| FLD_AR_ID | esriFieldTypeString | "18057C_1" | flood-area feature ID within the county DB |
| STUDY_TYP | esriFieldTypeString | "NP" | study type code |
| FLD_ZONE | esriFieldTypeString | "A", "X" | **the flood zone designation field** — confirmed live, matches build spec's assumed "FLD_ZONE" |
| ZONE_SUBTY | esriFieldTypeString | "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", null | zone subtype, frequently null for Zone A |
| SFHA_TF | esriFieldTypeString | "T" / "F" | **direct boolean-as-string flag for Special Flood Hazard Area** — this is the field to key SFHA determination on, not a derived rule off FLD_ZONE alone |
| STATIC_BFE | esriFieldTypeDouble | -9999.0 (sentinel for "not set") | Base Flood Elevation where a static value applies; **-9999 means null/not applicable, not a real elevation of -9999 ft** |
| DEPTH | esriFieldTypeDouble | -9999.0 | AO-zone depth, same sentinel convention |
| VELOCITY | esriFieldTypeDouble | -9999.0 | |
| V_DATUM | esriFieldTypeString | null | vertical datum |
| DUAL_ZONE | esriFieldTypeString | null | "T" flags dual-zone (e.g. AR/A reversion) parcels |
| AR_REVERT / AR_SUBTRV / BFE_REVERT / DEP_REVERT | various | null / -9999.0 | AR-zone reversion attributes |
| SOURCE_CIT | esriFieldTypeString | "18057C_FIRM1" | citation key linking to the Study_Info table (layer/table id 41) |
| GlobalID | esriFieldTypeGlobalID | UUID | |

Sample rows (Hamilton County, `DFIRM_ID='18057C'`, verbatim attributes):
```json
[
  {"OBJECTID":26727905,"DFIRM_ID":"18057C","FLD_AR_ID":"18057C_1","STUDY_TYP":"NP","FLD_ZONE":"A","ZONE_SUBTY":null,"SFHA_TF":"T","STATIC_BFE":-9999.0,"DEPTH":-9999.0,"VELOCITY":-9999.0,"SOURCE_CIT":"18057C_FIRM1"},
  {"OBJECTID":26727906,"DFIRM_ID":"18057C","FLD_AR_ID":"18057C_2","STUDY_TYP":"NP","FLD_ZONE":"X","ZONE_SUBTY":"0.2 PCT ANNUAL CHANCE FLOOD HAZARD","SFHA_TF":"F","STATIC_BFE":-9999.0,"SOURCE_CIT":"18057C_STUDY9"},
  {"OBJECTID":26727907,"DFIRM_ID":"18057C","FLD_AR_ID":"18057C_3","STUDY_TYP":"NP","FLD_ZONE":"X","ZONE_SUBTY":"0.2 PCT ANNUAL CHANCE FLOOD HAZARD","SFHA_TF":"F","STATIC_BFE":-9999.0,"SOURCE_CIT":"18057C_STUDY9"}
]
```
Full raw metadata: `data/raw/nfhl_layer28_flood_zones_meta.json`. Full raw Hamilton-scoped sample: `data/raw/nfhl_layer28_hamilton_sample3.json`. Generic (non-Hamilton) sample with the complete field list: `data/raw/nfhl_layer28_sample1.json`.

### Layer 3 — "FIRM Panels" (polygon; effective FIRM panel geometry + effective date)
| field | type | example value | notes |
|---|---|---|---|
| DFIRM_ID | esriFieldTypeString(6) | "18057C" | |
| PANEL | esriFieldTypeString(4) | "0233" | |
| SUFFIX | esriFieldTypeString(1) | "G" | |
| FIRM_PAN | esriFieldTypeString(11) | "18057C0233G" | full FIRM panel number |
| PANEL_TYP | esriFieldTypeString(30) | "Countywide, Panel Printed" | |
| EFF_DATE | esriFieldTypeDate | 1416355200000 (epoch ms = 2014-11-19) | **effective date of this FIRM panel** |
| PRE_DATE | esriFieldTypeDate | 253392451200000 (far-future sentinel, effectively "no preliminary date") | |
| SCALE | esriFieldTypeString(5) | "6000", "12000" | map scale denominator |
| BASE_TYP | esriFieldTypeString(10) | "NP" | |
| SOURCE_CIT | esriFieldTypeString(21) | "18057C_BASE12" | |

Sample rows (Hamilton County):
```json
[
  {"OBJECTID":808785,"DFIRM_ID":"18057C","FIRM_PAN":"18057C0233G","PANEL_TYP":"Countywide, Panel Printed","EFF_DATE":1416355200000,"SCALE":"6000"},
  {"OBJECTID":808786,"DFIRM_ID":"18057C","FIRM_PAN":"18057C0035G","PANEL_TYP":"Countywide, Panel Printed","EFF_DATE":1416355200000,"SCALE":"12000"},
  {"OBJECTID":808787,"DFIRM_ID":"18057C","FIRM_PAN":"18057C0205G","PANEL_TYP":"Countywide, Panel Printed","EFF_DATE":1416355200000,"SCALE":"12000"}
]
```
Full raw: `data/raw/nfhl_layer3_hamilton_sample3.json`, `data/raw/nfhl_layer3_firm_panels_meta.json`.

### Layer 22 — "Political Jurisdictions" (used to resolve DFIRM_ID/CID for a county/community)
Key fields: `DFIRM_ID`, `POL_NAME1`, `CO_FIPS`, `ST_FIPS`, `COMM_NO`, `CID`. Confirmed sample for Hamilton County, IN: `{"DFIRM_ID":"18057C","POL_NAME1":"HAMILTON COUNTY","CO_FIPS":"057","ST_FIPS":"18","COMM_NO":"0080","CID":"180080"}`. Full raw: `data/raw/nfhl_political_hamilton_in.json`.

### Full layer catalog (from MapServer root, `?f=json`)
Relevant layer IDs: `0` NFHL Availability, `3` FIRM Panels, `1` LOMRs, `34` LOMAs, `22` Political Jurisdictions, `16` Base Flood Elevations, `28` Flood Hazard Zones, `27` Flood Hazard Boundaries, `41` Study_Info (table). Full list: `data/raw/nfhl_mapserver_meta.json`.

## Gaps and risks
1. `STATIC_BFE`, `DEPTH`, `VELOCITY`, `BFE_REVERT`, `DEP_REVERT` all use **`-9999.0` as a null sentinel**, not JSON `null`, in the Hamilton County sample rows observed. Ingest code must treat `-9999` as "not applicable," not as a real elevation/depth/velocity value.
2. Filtering strategy confirmed and safe: `DFIRM_ID='18057C'` scopes all layers to Hamilton County. This was verified against layer 22 (political boundary), layer 28 (zones, 4,670 records), and layer 3 (panels) — all three respected the same DFIRM_ID.
3. The packaged FEMA MSC "county download" (a single zipped geodatabase) was not independently retrieved — only the live REST service was queried. A human/preprocessing script may prefer the MSC download for a stable, versioned snapshot rather than hitting the REST service at build time; this was not evaluated for availability/format in this pass.
4. Effective dates on the 3 sampled Hamilton County FIRM panels are all 2014-11-19 — whether this is uniform county-wide or varies by panel needs confirmation across the full 4,670+ panel set before assuming a single "effective FIRM date" per parcel join.

## Unverified claims
- Exact license/terms-of-use text for hazards.fema.gov data was not fetched from a dedicated terms page — assumed public-domain federal data per general FEMA.gov convention, not independently confirmed with a citation.
- Whether the MSC packaged county-download product differs in schema/currency from the live REST service was not evaluated.
- Whether Base Flood Elevation is more commonly populated for Hamilton County via the separate "Base Flood Elevations" (layer 16, polyline) rather than `STATIC_BFE` on layer 28 was not tested — the 3 sampled zone-28 rows all showed `-9999` for `STATIC_BFE`, which is expected for Zone A (BFE not determined) but should be checked against Zone AE parcels near the White River in Noblesville specifically before assuming BFE data is absent county-wide.
