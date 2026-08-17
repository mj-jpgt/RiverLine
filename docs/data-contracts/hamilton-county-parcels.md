---
# Hamilton County, Indiana — Parcels + Assessor Values
**Status:** VERIFIED (fields, sample rows, endpoint) / PARTIAL (market-value field does not exist as such — see Gaps)
**Primary source URL:** https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer/0
**Retrieved:** 2026-08-17
**Retrieved by:** research agent
**License / terms:** Not stated on the service metadata page. No terms-of-use text or license field was returned by `?f=json`. Hamilton County's public GeoHub portal (https://geohub.hamiltoncounty.in.gov/) should be checked by a human for a stated open-data license before redistribution; this service returned no explicit license string. Treat as UNKNOWN until confirmed.

## How to obtain
Query the live ArcGIS REST FeatureServer directly (no login required, confirmed 2026-08-17):

```
# Layer metadata / field list
curl "https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer/0?f=json"

# Sample rows
curl "https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer/0/query?where=1=1&outFields=*&resultRecordCount=3&f=json"

# Full record count
curl "https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer/0/query?where=1=1&returnCountOnly=true&f=json"
```

There is also a discoverable open-data landing page at
https://geohub.hamiltoncounty.in.gov/datasets/parcels-open-data (not independently re-verified beyond the search result; the REST service above was fetched directly and is the authoritative source used for this contract).

`maxRecordCount` per request is 2000 (`standardMaxRecordCount` 4000, `standardMaxRecordCountNoGeometry` 32000). Bulk export supports `sqlite,filegdb,shapefile,csv,geojson` via `supportedExportFormats`. Full-table pulls must page with `resultOffset`/`resultRecordCount`.

**Record count (live, 2026-08-17):** 153,883 parcels (`returnCountOnly=true` → `{"count":153883}`).

**Coordinate system:** `wkid 2244` (NAD83 Indiana East, US Survey Feet), `latestWkid 2965`. Vertical: NAVD_1988. Units: `esriFeet`.

**Last-updated date:** Per-record `EXPORTDATE` field carries a per-refresh timestamp (sample row: epoch ms `1786741864000`). `AVTAXYR` in the sampled rows is `2026`, indicating the assessed-value snapshot is current-year. No single "layer last refreshed" timestamp was exposed by the service metadata beyond per-feature `EXPORTDATE`.

## Observed fields
(Full list from `?f=json`, layer id 0, name "Parcels". Only the fields most relevant to A3/M3 are annotated; the complete field list is in `data/raw/hamco_parcels_layer0_meta.json`.)

| field | type | example value | notes |
|---|---|---|---|
| OBJECTID | esriFieldTypeOID | 1 | internal, not stable across refreshes — do not use as durable parcel key |
| PARCELNO | esriFieldTypeString(16) | "1111060000014201" | unformatted 16-digit local parcel number |
| FMTPRCLNO | esriFieldTypeString(22) | "11-11-06-00-00-014.201" | formatted local parcel number |
| STPRCLNO | esriFieldTypeString(24) | "29-11-06-000-014.201-013" | State-formatted parcel number (Indiana 18-digit key + county code) |
| STPRCLNO_UNFORMATTED | esriFieldTypeString(18) | "291106000014201013" | **candidate durable parcel ID** — statewide unique |
| LOCADDRESS | esriFieldTypeString(4000) | "16787 Clover Rd" | full situs address string |
| LOCHSENUMR / LOCSTRDIR / LOCSTRNAME / LOCSTRSUF | String | "16787" / null / "Clover" / "Rd" | situs address components |
| LOCCITY / LOCZIP | String | "Noblesville" / "46060" | |
| DEEDEDOWNR / OWNNAME | String(4000) | "Town & Country Noblesville Station LLC" | |
| PROPCLASS | esriFieldTypeString(3) | "425" | Indiana property class code (numeric string, e.g. 101 = ag, 425 = commercial) — **this is the property class field**, not a plain-English land-use field |
| PROPUSE | esriFieldTypeString(255) | "Neighborhood shopping center" | plain-English use description tied to PROPCLASS |
| AVLAND | esriFieldTypeDouble | 2172000.0 | assessed value — land |
| AVIMPROVE | esriFieldTypeDouble | 2490200.0 | **assessed value — improvements** (this is the "assessed improvement value" field named in the build spec) |
| AVTOTGROSS | esriFieldTypeDouble | 4662200.0 | assessed value — total (land + improvements), gross, pre-deduction |
| AVTAXYR | esriFieldTypeInteger | 2026 | tax/assessment year the AV* fields apply to |
| sq_ft_res | esriFieldTypeInteger | 1973 | residential square footage (null on non-residential/vacant parcels) |
| sq_ft_comm | esriFieldTypeInteger | 49797 | commercial square footage |
| year_built | esriFieldTypeInteger | 1973 | |
| num_floors | esriFieldTypeString(4) | "1.0 " | stored as string, not integer — note trailing space in sample |
| DEEDACRES | esriFieldTypeDouble | 6.55 | |
| CORPLIMIT | esriFieldTypeString(25) | "Noblesville" / "Unincorporated" | jurisdiction name — usable for jurisdiction_id mapping |
| TAXDISTNAM | esriFieldTypeString(50) | "Noblesville City" | tax district name, finer-grained than CORPLIMIT |
| POLTWP | esriFieldTypeString(50) | "Noblesville" | political township |
| HOMESTEAD | esriFieldTypeString(10) | "Active" / null | homestead deduction status |
| PROPERTYREPORT | esriFieldTypeString(255) | "https://secure2.hamiltoncounty.in.gov/propertyreports/reports.aspx?parcel=1111060000014201" | live link to county property report per parcel |
| Shape | esriFieldTypeGeometry | polygon rings | parcel boundary geometry |
| GlobalID | esriFieldTypeGlobalID | UUID | |

## Sample rows (verbatim, 3 rows, attributes only — geometry omitted here, present in raw file)
```json
[
  {
    "OBJECTID": 1,
    "FMTPRCLNO": "11-11-06-00-00-014.201",
    "STPRCLNO_UNFORMATTED": "291106000014201013",
    "LOCADDRESS": "16787 Clover Rd",
    "LOCCITY": "Noblesville",
    "LOCZIP": "46060",
    "PROPCLASS": "425",
    "PROPUSE": "Neighborhood shopping center",
    "AVLAND": 2172000.0,
    "AVIMPROVE": 2490200.0,
    "AVTOTGROSS": 4662200.0,
    "AVTAXYR": 2026,
    "CORPLIMIT": "Noblesville",
    "sq_ft_comm": 49797,
    "sq_ft_res": null,
    "year_built": null
  },
  {
    "OBJECTID": 2,
    "FMTPRCLNO": "08-09-07-00-00-032.101",
    "STPRCLNO_UNFORMATTED": "290907000032101014",
    "LOCADDRESS": "15636 Joliet Rd",
    "LOCCITY": "Westfield",
    "LOCZIP": "46074",
    "PROPCLASS": "101",
    "PROPUSE": "Cash grain/general farm",
    "AVLAND": 96200.0,
    "AVIMPROVE": 218200.0,
    "AVTOTGROSS": 314400.0,
    "AVTAXYR": 2026,
    "CORPLIMIT": "Unincorporated",
    "sq_ft_res": 1973,
    "year_built": 1973,
    "num_floors": "1.0 "
  },
  {
    "OBJECTID": 3,
    "FMTPRCLNO": "07-04-31-00-00-026.102",
    "STPRCLNO_UNFORMATTED": "290431000026102017",
    "LOCADDRESS": "0 Cornell Rd",
    "LOCCITY": "Noblesville",
    "LOCZIP": "46060",
    "PROPCLASS": "100",
    "PROPUSE": "Ag - Vacant lot",
    "AVLAND": 57300.0,
    "AVIMPROVE": null,
    "AVTOTGROSS": 57300.0,
    "AVTAXYR": 2026,
    "CORPLIMIT": "Unincorporated"
  }
]
```
Full raw response with geometry: `data/raw/hamco_parcels_sample3.json`. Full field schema: `data/raw/hamco_parcels_layer0_meta.json`.

## Gaps and risks
1. **No "total market value" field exists.** The build spec (§4.1) calls for "assessed improvement value, total market value." The live schema has `AVLAND`, `AVIMPROVE`, `AVTOTGROSS` (all *assessed* values, tax-year `AVTAXYR`) and nothing labeled market value. Indiana's assessment system is statutorily supposed to target "market value-in-use," but that is a legal characterization of the assessment methodology, not a separate field in this data — **do not treat AVTOTGROSS as an independently-sourced market value without a human confirming Indiana assessment law equivalence for this jurisdiction and tax year.** This is exactly the ambiguity the build spec's `value_source` field and official-override path exist to handle (§4.1) — implement that path; do not silently substitute AVTOTGROSS for "market value."
2. `PROPCLASS` is a 3-digit numeric code, not a self-describing category. A human must obtain Indiana's DLGF property class code table (source: Indiana Department of Local Government Finance) to map codes like "101", "425", "100" to occupancy/use categories needed by the 50%-rule engine's structure-attribute step. This code table was NOT retrieved in this pass — flag as a follow-up.
3. `num_floors` is stored as a **string** (e.g. `"1.0 "` with a trailing space), not numeric — ingest code must trim/parse, not assume integer type.
4. `sq_ft_res` / `sq_ft_comm` are frequently `null` (e.g. row 3, a vacant lot) — structure square footage is not guaranteed to be populated from parcel data alone; the capture flow must allow manual entry as the build spec already specifies (§5.2).
5. No explicit situs-parcel "durable primary key" field is labeled as such; `STPRCLNO_UNFORMATTED` (18-digit statewide parcel number) is the best candidate but this is an inference, not a stated primary key in the service metadata — confirm with the county before using it as the join key to NFHL/USGS precomputed tables.
6. License/terms of use were not found on the service response. A human should check https://geohub.hamiltoncounty.in.gov/ directly for a stated open-data license before any redistribution beyond internal preprocessing.
7. `OBJECTID` is explicitly NOT stable/durable per Esri convention (can change on data refresh) — do not use as a foreign key.

## Unverified claims
- Whether `geohub.hamiltoncounty.in.gov/datasets/parcels-open-data` points to this same FeatureServer or a different/older extract was not independently confirmed — only the REST service URL above was directly queried.
- Whether Hamilton County's AVTOTGROSS is legally equivalent to "market value" as used in FEMA P-758 (substantial-damage value determination) was NOT verified — this requires either a human legal/assessor confirmation or reliance on the official-override / appraisal path per build spec §4.1.
- The DLGF property class code table (mapping `PROPCLASS` codes to categories) was not retrieved — NOT FOUND in this pass.
- Update cadence / refresh frequency of this FeatureServer is unknown beyond the per-row `EXPORTDATE` and `AVTAXYR=2026` in the sample.
