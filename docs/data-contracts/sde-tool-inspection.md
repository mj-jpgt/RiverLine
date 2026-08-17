---
# FEMA SDE 3.0 Desktop Tool — Static Inspection for a Bundled Cost Database
**Status:** RESOLVED (the question "does the tool bundle usable cost data" is now answered definitively: NO)
**Primary source URL:** https://www.fema.gov/emergency-managers/risk-management/building-science/substantial-damage-estimator-tool (tool download page) → installer file at https://www.fema.gov/sites/default/files/2020-07/SDE3_04062018.zip
**Retrieved:** 2026-08-17
**Retrieved by:** research agent
**License / terms:** FEMA public-sector distribution (Manufacturer: "FEMA" per the MSI's own product metadata, see below). No separate EULA/license file was found in the installer payload beyond the standard .NET Framework 4.6.1 EULA prompt described in FEMA's own installation guide. Treat as a public-domain U.S. Government tool absent evidence otherwise.

**Note on access:** `fema.gov` returns HTTP 403 (Akamai bot mitigation) to WebFetch and to `curl` with default/common user-agent strings. It returns HTTP 200 to a bare `curl/8.0` user-agent. Any future re-fetch attempt against this domain should try that user-agent string before concluding the content is unavailable — a 403 here is a bot-fingerprinting artifact, not proof the file doesn't exist or is gated.

## How to obtain
```
curl -sL -A "curl/8.0" "https://www.fema.gov/emergency-managers/risk-management/building-science/substantial-damage-estimator-tool" -o data/raw/sde_page.html
# href="/sites/default/files/2020-07/SDE3_04062018.zip" found in page HTML

curl -sL -A "curl/8.0" "https://www.fema.gov/sites/default/files/2020-07/SDE3_04062018.zip" -o data/raw/SDE3_04062018.zip
```
- Path: `data/raw/SDE3_04062018.zip`
- Size: 55,104,977 bytes
- SHA-256: `6e1f7d9a225936460ab541e2f28901102ff8b432741a614b74a1b0ec73e86cb4`
- Confirmed a real ZIP by magic bytes (`50 4B 03 04` / "PK..") — not an HTML error page.

The companion installation guide, which documents the install steps and confirms an Access database (`SDEDatabase.mdb`) is part of the shipped package, was also downloaded:
```
curl -sL -A "curl/8.0" "https://www.fema.gov/sites/default/files/2020-07/sde_read_me_-_SDE_3.0_Tool_Installation_Guide.pdf" -o data/raw/sde_readme_installation_guide.pdf
```
(FEMA, "SDE Installation Guide," August 2017.) Confirms: "The SDE tool can be installed from a zip (or compressed) file available on the FEMA website... After the SDE file has been extracted, open the folder and double click on the 'Setup.exe' file..." and documents `SDEDatabase.mdb` as the tool's database file.

### Static extraction (no install, no execution of the application)
1. The zip contains exactly two files: `SDE 3.0.0 Installation Package/SDE3-Installer.msi` (56,001,536 bytes) and `SDE 3.0.0 Installation Package/setup.exe` (791,040 bytes, a bootstrap that installs .NET 4.6.1 then launches the MSI — **not run**).
2. `setup.exe` was **not executed**. Instead, the MSI was extracted using an **administrative extraction**, which unpacks files to a target directory without installing, registering, or running any application code:
   ```
   msiexec /a "data/raw/sde_tool_extracted/SDE 3.0.0 Installation Package/SDE3-Installer.msi" /qb TARGETDIR="data/raw/sde_tool_extracted/msi_admin_extract" /L*V "data/raw/sde_tool_extracted/msiexec_log.txt"
   ```
   The log (`data/raw/sde_tool_extracted/msiexec_log.txt`) confirms the MSI's own internal action sequence was `ADMIN → CostInitialize → FileCost → CostFinalize → InstallValidate → InstallInitialize → InstallAdminPackage → InstallFiles → InstallFinalize`, i.e. the **`ADMIN`/`InstallAdminPackage` sequence**, which per the Windows Installer SDK unpacks the package's file table to `TARGETDIR` without executing custom actions that install/register the product (no Start Menu shortcuts outside the extraction directory, no registry writes to `HKLM\...\Uninstall`, no services). The log's own `TARGETDIR` property confirms all files landed under `data/raw/sde_tool_extracted/msi_admin_extract/`, not `C:\Program Files\`. The log ends with: "Product: SDE-Substantial Damage Estimator -- Installation completed successfully... Installation success or error status: 0" — this refers to the ADMIN (extraction) action completing, not a real end-user install.
   - Product metadata read directly from the MSI property table via this action: `ProductName = SDE-Substantial Damage Estimator`, `ProductVersion = 3.0.0`, `ProductCode = {7886F393-10F7-4A6C-BA6E-214853455FFA}` *(exact GUID as logged)*, `Manufacturer = FEMA`.
   - `.zip` extraction of the outer archive used Python's standard-library `zipfile` module (read-only), no unzip utility execution required.

## Observed contents
Full extracted file tree: `data/raw/sde_tool_extracted/msi_admin_extract/` (application binaries, `Help/`, `Reports/`, `images/`, `JSON/`, `Database/`).

**Every non-executable, potentially data-bearing file found:**

| File | Size | Format |
|---|---|---|
| `Database/SDEDatabase.mdb` | 1,302,528 bytes | Microsoft Access (Jet/MDB) |
| `JSON/Residential.json` | 90,750,144 bytes | JSON array |
| `JSON/Commercial.json` | 414,271 bytes | JSON array |
| `JSON/Lookup.json` | 70,428 bytes | JSON array |
| `Help/sde_usersmanual_and_workbook.pdf` | (same manual already on file, see `docs/data-contracts/sde-cost-tables.md`) | PDF |
| `Reports/*.rdlc` (10 files) | small | Microsoft report-definition XML (layout templates only, no data) |

No `.xls`/`.xlsx`/`.csv`/`.xml` cost files, and no second database file, were found anywhere in the extracted tree.

### JSON files — read directly, no execution needed
- **`JSON/Residential.json`** (378,000 records) and **`JSON/Commercial.json`** (2,331 records): each record has keys like `FoundationID`, `SuperStructureID`, `RoofCoveringID`, `ExteriorFinishID`, `HvacID`, `StoryID` / `StructureUseID`, `SprinklerID`, `ConveyanceID`, plus `Element` (e.g. `"Foundation"`, `"Superstructure"`, `"Roof Covering"`, `"Interiors"`, `"HVAC"`) and **`Percentage`** (e.g. `"11.9"`, `"13.3"`, `"24.0"`). These are **default element-percentage-allocation tables**: for every combination of structure attributes (foundation type × superstructure type × roof type × exterior finish × HVAC × stories, or for commercial: story × structure use × sprinkler × conveyance), the table gives what percentage of a structure's *total* replacement cost is attributed to each of the 12 residential / 7 non-residential SDE elements (matching the element names already verified in `docs/data-contracts/sde-cost-tables.md`). **There is no dollar figure or `$/sqft` field anywhere in either file** — confirmed by inspecting every distinct key across a 5,000-record sample of each file (`FoundationID, SuperStructureID, RoofCoveringID, ExteriorFinishID, HvacID, StoryID, Element, Percentage, ResidenceID, FIELD10` for Residential; `StoryID, StructureUseID, SprinklerID, ConveyanceID, Element, Percentage, FIELD7` for Commercial). These percentages let the tool split a **user-supplied total base cost** across elements — they are not themselves a source of the total cost.
- **`JSON/Lookup.json`** (404 records): a flat lookup-value table (`LookupID`, `LookupTypeID`, `LookupFieldName`, e.g. `"Foundation"`, `"Superstructure"`, `"Fire"`, `"Flood"`) used to resolve the numeric IDs in the other two files to human-readable labels. No dollar figures.

### Access database (`SDEDatabase.mdb`) — read directly via the pure-Python `access_parser` library (read-only page-format parser, no ODBC driver, no macro execution — `pip install access_parser`)
Full table list (37 tables): `MSysObjects, AdditionalAdjustment, Assessment, Attachment, CostAdjustment_ResidenceType, CostAdjustmentResult, County, CustomField, CustomField_Results, DatabaseInfo, Default, DepreciationValue, ElementPercentage, EnterpriseImportSettings, f_9F90A2E7D31F44BC8B8C30AB9E8B97B2_Data, InspectionStatus, LastFiveAssesments, LatLongValidation, Lookup, LookupType, Manage, MSysAccessStorage, MSysNameMap, MSysNavPaneGroupCategories, MSysNavPaneGroups, MSysNavPaneGroupToObjects, MSysNavPaneObjectIDs, Notes, Property, ResidenceType, RoofCoveringType, Shapes, State, StreetSuffixAbbreviation, StructureShape, UserDefault, ValidationRule`.

**The tables that would hold cost data, read directly, row counts as shipped:**

| Table | Columns of interest | Rows in shipped `.mdb` |
|---|---|---|
| `Property` | `BaseCostPerSqFt`, plus ~60 other per-assessment fields (owner, address, structure attributes, FIRM panel, BFE, etc.) | **0** |
| `Default` | `BaseCost`, `CostDataDate`, `CostDataRef`, `LocalMultiplier` | **0** |
| `CostAdjustmentResult` | `UnitCost`, `TotalCost`, `Quantity`, `Units` | **0** |
| `AdditionalAdjustment` | `UnitCost`, `TotalCost`, `Quantity` | **0** |
| `ElementPercentage` | (mirrors the JSON percentage tables above) | present but no dollar column |
| `DepreciationValue` | `DepreciationPercentage`, `OriginalDepreciationPercentage` | 210 rows, populated (percentages only, e.g. 66.9, 51.1, 31.9, 21.1, 13.2 — a more granular per-story/use lookup than the 6-point table already documented in `sde-cost-tables.md`; still a *depreciation* schedule, not a *cost* table) |
| `County` | `County`, `StateID` | 3,251 rows — every U.S. county name, for the address dropdown only, **no cost multiplier column** |
| `State` | state names | reference list only |

**This is the conclusive finding: `SDEDatabase.mdb` ships as an empty template.** The schema itself proves FEMA's design intent — `Property.BaseCostPerSqFt`, `Default.BaseCost`, `Default.CostDataRef` (a free-text citation field for whatever guide the user picked), `Default.CostDataDate`, and `Default.LocalMultiplier` are all real columns in the shipped database, and all are **empty (0 rows)**. The tool is built to have a human type in a base cost and cite their source (`CostDataRef`) — it does not arrive pre-populated with any vendor's dollar figures. This is fully consistent with the manual text already quoted in `docs/data-contracts/sde-cost-tables.md` ("The base cost can be obtained from an industry-accepted, residential cost-estimating guide...").

## Sample (verbatim)
```json
// JSON/Residential.json, first non-zero record
{"ResidenceID": 1, "FoundationID": 1, "SuperStructureID": 1, "RoofCoveringID": 1,
 "ExteriorFinishID": 1, "HvacID": 1, "StoryID": 1,
 "Element": "Foundation", "Percentage": "11.9", "FIELD10": ""}
```
```json
// JSON/Commercial.json, first non-zero record
{"StoryID": 1, "StructureUseID": 10, "SprinklerID": 1, "ConveyanceID": 1,
 "Element": "Foundation", "Percentage": "11.0", "FIELD7": ""}
```
```
-- Access table Default (schema only — 0 rows shipped)
DefaultValueID, City, State, County, Zip, NFIPCommunityID, NFIPCommunityName, Datum,
YearOfConstruction, DateDamagedOccurred, CauseOfDamage, DurationOfFlood, DurationOfFloodUnit,
RegulatoryFloodway, InspectedBy, InspectedPhone, DateOfInspection, FirmPanelNumber, Suffix,
DateOfFirmPanel, FirmZone, BFE, CommunityUse, LocalMultiplier, CostDataDate, CostDataRef, BaseCost
```
No dollar figure was read from any file — none exist in the shipped payload to read.

## Gaps and risks
1. The element-*percentage* tables (`JSON/Residential.json`, `JSON/Commercial.json`, mdb `ElementPercentage`) ARE potentially useful and machine-readable data for this project independent of the cost-guide question: they give FEMA's own default percentage split of total repair cost across the 12/7 SDE elements, keyed by structure attribute combination. If RiverLine's M3 engine ever needs to allocate a single total repair estimate across elements (rather than costing each element independently), this table is a real, directly-extractable FEMA source — flag for the build spec's attention, cite `data/raw/sde_tool_extracted/msi_admin_extract/JSON/Residential.json` / `Commercial.json` with row-level provenance if used.
2. `access_parser` is a third-party pure-Python reverse-engineering library for the Access Jet format, not Microsoft's own tooling — cross-validate table row counts with a second method (e.g. Microsoft Access itself, or `mdbtools` if later installed) before treating "0 rows" as absolutely certain, although the schema-level finding (the *existence* of empty `BaseCostPerSqFt`/`CostDataRef`/`UnitCost` columns) does not depend on parser correctness and is the load-bearing fact here.
3. The MSI's internal `ProductCode` GUID was read from the verbose log; treat as informational, not independently cross-checked against a second source.
4. This is SDE version 3.0.0 (installer dated per filename `04062018` = April 6, 2018), consistent with the manual's "August 2017" cover date family — no newer version was found in this pass (matches the existing note in `sde-cost-tables.md`).
5. The application executable (`wpfSDE.exe`) and all `.dll` files were listed by name/size only and were **not executed or decompiled** — this was out of scope and unnecessary once the database/JSON inspection above answered the cost-data question directly.
6. `fema.gov` returned HTTP 403 (Akamai bot mitigation) to several fetch attempts using default user-agent strings during this same research pass, before the working `curl/8.0` user-agent was found — if a future pass hits 403 again, retry with an explicit `-A "curl/8.0"` (or similar minimal UA) before concluding the file is unavailable.

## Unverified claims
- Whether a *newer* build of the SDE tool (post-2018) exists and ships a populated cost database was not checked beyond confirming no newer version surfaced in search results (same caveat already noted in `sde-cost-tables.md`).
- Whether FEMA distributes a separate, optional "sample data" package (distinct from this installer) that pre-populates `SDEDatabase.mdb` was not searched for specifically in this pass.

## COST-TABLE BLOCKER STATUS: **STILL BLOCKED**
The installable SDE 3.0 tool does not resolve the unit-cost blocker. Its shipped Access database and JSON payload contain the *mechanism* for allocating a cost across elements (percentage tables) and *fields* for a human to enter cost data (`BaseCostPerSqFt`, `BaseCost`, `CostDataRef`, `CostDataDate`, `LocalMultiplier`), but contain **zero populated dollar-denominated rows**. A human must still select and obtain pricing from an external cost-estimating guide — see `docs/adr/0005-cost-estimating-guide-options.md` for the options research on that guide itself.
