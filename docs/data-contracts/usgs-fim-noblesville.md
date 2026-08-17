---
# USGS Flood Inundation Mapping (FIM) — Noblesville, IN / White River
**Status:** VERIFIED (gage, stage range, download URLs, format) — depth grid archive itself not downloaded (79 MB, see note)
**Primary source URL:** https://www.sciencebase.gov/catalog/item/5909fd0ce4b0fc4e44916004
**Retrieved:** 2026-08-17
**Retrieved by:** research agent
**License / terms:** U.S. Government work / public domain (USGS ScienceBase data release). No restrictive license found.

## How to obtain
Publication (methodology, defines the 15 stage profiles): Martin, Z.W., 2017, *Flood-Inundation Maps for the White River at Noblesville, Indiana*, USGS Scientific Investigations Report 2017–5123, https://doi.org/10.3133/sir20175123 (PDF: https://pubs.usgs.gov/sir/2017/5123/sir20175123.pdf — not downloaded in this pass, lead only).

Data release (GIS/model archive), ScienceBase parent item `5909fd0ce4b0fc4e44916004`, DOI `10.5066/F7MG7N0J`, has 3 child items (confirmed via ScienceBase API, `data/raw/sciencebase_noblesville_children.json`):

```
# Parent item metadata (works via curl; browser-UA WebFetch was blocked with 403 — use curl/API, not WebFetch, for sciencebase.gov)
curl "https://www.sciencebase.gov/catalog/item/5909fd0ce4b0fc4e44916004?format=json"

# List child items
curl "https://www.sciencebase.gov/catalog/items?parentId=5909fd0ce4b0fc4e44916004&format=json&max=50"

# Depth grids item detail + direct file URLs
curl "https://www.sciencebase.gov/catalog/item/590a1c49e4b0fc4e4491605d?format=json"
```

Three child items:
1. **Shapefile of the flood-inundation maps** — item id `590a1bdce4b0fc4e4491605a`
2. **Depth grids of the flood-inundation maps** — item id `590a1c49e4b0fc4e4491605d`
3. **Model Archive (HEC-RAS inputs/outputs)** — item id `599db18ae4b012c075b96584`

**Depth grid direct download (verified, not downloaded to `data/raw/` due to size):**
- File: `wrnoblein_XX_depthgrid.zip`, **79,001,304 bytes (~79 MB)**
- URL: `https://www.sciencebase.gov/catalog/file/get/590a1c49e4b0fc4e4491605d?f=__disk__a0%2F65%2F6f%2Fa0656f4403e61fa18437ae79a04dc371ebebea67`
- Companion FGDC metadata XML: `wrnoblein_XX_depthgrid_FGDC.xml`, 18,680 bytes, `https://www.sciencebase.gov/catalog/file/get/590a1c49e4b0fc4e4491605d?f=__disk__38%2F9f%2F96%2F389f965b51c06110bdb196d9c32cc5a7614f87c6`
- The `XX` in the filename is a placeholder for stage — the zip is expected to contain one grid per 1-ft stage interval (10.0–24.0 ft, 15 grids); this was inferred from the SIR 2017-5123 abstract, not confirmed by unzipping (not downloaded).
- Format: not explicitly labeled in the metadata retrieved; USGS FIM depth-grid deliverables of this era are typically Esri grid/raster (.flt or Esri GRID) inside the zip — **NOT independently confirmed by inspecting file contents in this pass.**

## Observed fields (gage / model parameters — VERIFIED)
| item | value | source |
|---|---|---|
| USGS streamgage number | **03349000** | confirmed via `https://waterservices.usgs.gov/nwis/site/?sites=03349000&format=rdb` → `station_nm = "WHITE RIVER AT NOBLESVILLE, IN"`, `dec_lat_va=40.04697647`, `dec_long_va=-86.0171855`, `alt_va=737.80` (NAVD88), `huc_cd=05120201` |
| NWS site ID | NBLI3 | ScienceBase item body text (`data/raw/sciencebase_noblesville_fim.json`) |
| Stage range modeled | **10.0 ft to 24.0 ft**, 1-ft intervals (15 profiles) | ScienceBase item body: "computed 15 water-surface profiles for flood stages at 1-foot (ft) intervals referenced to the streamgage datum ranging from 10.0 ft (the NWS 'action stage') to 24.0 ft, which is the highest stage interval of the current (2016) USGS stage-discharge rating curve and 2 ft higher than the NWS 'major flood stage.'" |
| Model ceiling | **24.0 ft** — explicitly the top of the rating curve at time of study | same source |
| Calibration events | Sept 4, 2003 and May 6, 2017 high-water marks | same source |
| Elevation data source | LiDAR DEM, 0.98-ft vertical accuracy, 4.9-ft horizontal resolution | same source |
| Reach length | 7.5 miles | same source |
| Hydraulic model | 1-D step-backwater, USACE software (HEC-RAS implied by "Model Archive" child item name; not spelled out verbatim in the body text quoted) | ScienceBase item body |

## Sample rows (verbatim)
Not applicable in the tabular sense — this is a raster/document dataset, not a queryable feature service. The verbatim gage-site record (RDB format) is saved at `data/raw/usgs_gage_03349000_site.txt`. The verbatim ScienceBase item JSON is saved at `data/raw/sciencebase_noblesville_fim.json` and `data/raw/sciencebase_depthgrids.json`.

## Gaps and risks
1. **24.0 ft is a hard model ceiling, not a real-world cap on flood stage.** Per build spec §4.4, any observed/forecast crest above 24.0 ft must be flagged as extrapolation beyond the modeled range — this agent did not verify what the actual crest was for any specific flood event; that is an operational/runtime fact, not a dataset fact, and must be sourced at determination time from NWS/USGS real-time data, not invented here.
2. The depth-grid zip (79 MB) was NOT downloaded in this pass — confirmed reachable and its size/hash-eligible URL recorded, but file contents (exact raster format, grid naming per stage, projection) were not inspected. A human/preprocessing script must download and unzip to confirm the internal file-per-stage naming convention before writing ingest code.
3. Whether the archive's projection matches the parcel data's `wkid 2244`/`2965` (Hamilton County parcels, State Plane Indiana East) was not checked — this must be verified before any `scripts/preprocess/` spatial join, per build spec's requirement that all geospatial joins happen once, offline.
4. The SIR 2017-5123 report PDF (methodology detail, may include per-stage discharge and additional caveats) was located but not downloaded/read in this pass — lead only: https://pubs.usgs.gov/sir/2017/5123/sir20175123.pdf.

## Unverified claims
- Internal depth-grid file format (Esri GRID vs. .flt vs. GeoTIFF) — not confirmed, inferred only from typical USGS FIM practice of this era, which is NOT a citable fact for this document; treat as NOT FOUND until the zip is opened.
- Exact per-stage file-naming convention inside the zip (`wrnoblein_XX_depthgrid.zip`, `XX` placeholder meaning) — not confirmed.
Note: HEC-RAS as the specific hydraulic model IS confirmed (moved out of "unverified") — the ScienceBase parent item body text explicitly reads "three child items that contain U.S. Army Corps of Engineers HEC-RAS Model inputs and outputs" (`data/raw/sciencebase_noblesville_fim.json`).
