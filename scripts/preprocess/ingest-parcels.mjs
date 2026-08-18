#!/usr/bin/env node
// pnpm ingest:parcels — real Hamilton County parcel + FEMA NFHL ingest for
// the "structures" table (T-C2, specs/core/tasks.md).
//
// This is tabular REST paging against two live ArcGIS REST services, not
// raster work — Python/GeoPandas stays reserved for future depth-grid work
// per the raster ADR (AGENTS.md "Geospatial"); a plain Node script is the
// right tool here, matching scripts/db/*.mjs's existing style.
//
// ---------------------------------------------------------------------
// SOURCES (every field name below is taken verbatim from these contracts;
// nothing here is invented — AGENTS.md rule 4):
//   docs/data-contracts/hamilton-county-parcels.md
//   docs/data-contracts/fema-nfhl.md
//   docs/data-contracts/dlgf-property-classes.md
// ---------------------------------------------------------------------
//
// BOUNDING ENVELOPE
// ---------------------------------------------------------------------
// Noblesville, IN sits at approximately 40.0456 N, -86.0086 W. The bbox
// below (-86.03,40.03,-85.99,40.06 in WGS84 lon/lat) was chosen empirically
// by querying the live parcel FeatureServer's returnCountOnly for a few
// candidate envelopes around downtown Noblesville / the White River
// corridor (verified 2026-08-17, live service):
//   -86.045,40.02,-85.985,40.07  -> 7,260 parcels (too many)
//   -86.03,40.03,-85.99,40.06    -> 3,842 parcels (target range, USED BELOW)
//   -86.05,40.01,-85.97,40.08    -> 12,284 parcels (too many)
// This lands in the 1,000-5,000 target and covers the White River corridor
// through downtown Noblesville, so the flood-zone join below is meaningful
// (not just Zone X / unmapped parcels). Same envelope is used, in the same
// WGS84 lon/lat CRS, for both the parcel and NFHL queries (both REST
// services accept inSR=4326 on an esriGeometryEnvelope filter and return
// outSR=4326 coordinates, so no projection math is needed in this script).
//
// FULL-COUNTY MODE (F1 registry coverage task, 2026-08-18)
// ---------------------------------------------------------------------
// The original envelope above (~3,821 parcels) was always a deliberate
// starting subset, not full coverage (see build-spec target range note
// below) — the field report this task responds to is exactly that: a real
// flooded address outside the Noblesville envelope has no structure row at
// all. Pass `--full` (or set INGEST_MODE=full) to ingest the WHOLE county
// (153,883 parcels per hamilton-county-parcels.md's verified count) instead
// of the bbox. Full mode:
//   - Parcels: pages with `where=1=1` (no geometry filter at all — every
//     parcel in the county, not just ones inside an envelope), same
//     resultOffset paging as bbox mode.
//   - NFHL zones/panels: paged too (bbox mode's single-request assumption
//     doesn't hold county-wide — verified live 2026-08-18: 4,670 zone
//     features, 89 panel features for DFIRM_ID='18057C' with no geometry
//     filter, both need paging against the service's maxRecordCount 2000).
//   - DB writes: batched multi-row INSERT...ON CONFLICT per fetched page
//     (up to PAGE_SIZE rows per statement) instead of one round-trip per
//     row — the row-at-a-time loop bbox mode used is fine for ~3,800 rows
//     but far too slow (network round-trips) for 153,883.
// RESUMABILITY / CHECKPOINTING: each page's raw JSON response is cached to
// disk (parcels/ and nfhl/ under data/raw/ingest/, namespaced by mode — see
// cacheDir below) BEFORE it is parsed, so an interrupted run (the 10-minute
// foreground command cap) that is re-invoked skips every already-fetched
// page for free and resumes paging from the first missing one. The DB
// upsert loop is separately idempotent (ON CONFLICT...DO UPDATE, same as
// bbox mode) so re-running it from the top after an interruption is always
// safe, just re-writes already-loaded pages once more — batching keeps that
// cost small. This combination (cache-based fetch resume + idempotent
// batched upsert) is the "checkpoint via resultOffset, re-runnable" the
// task calls for, without a separate progress-tracking table or file that
// could itself drift from what's actually committed to the database.
//
// PIPELINE
// ---------------------------------------------------------------------
// 1. Page the parcel FeatureServer (Layer 0) — across the Noblesville
//    envelope in the default mode, or the whole county in --full mode —
//    with resultOffset paging, a polite delay between pages, and retry-
//    with-backoff on transient failures. Each page's raw JSON response is
//    cached under data/raw/ingest/parcels[_full]/ (gitignored via data/raw/
//    — see .gitignore) so a re-run with the cache present needs no network
//    call for that page.
// 2. Fetch NFHL Layer 28 (Flood Hazard Zones) and Layer 3 (FIRM Panels),
//    filtered to Hamilton County via DFIRM_ID='18057C' (verified county
//    identifier, fema-nfhl.md), and additionally by the same envelope in
//    bbox mode. Paged the same way as parcels; cached to data/raw/ingest/nfhl[_full]/.
// 3. For each parcel, compute an area-weighted centroid of its outer ring
//    (shoelace-formula polygon centroid — no new dependency) and run a
//    point-in-polygon test (even-odd rule across all rings, which handles
//    holes correctly regardless of ring winding) against every fetched
//    flood-zone and FIRM-panel polygon to assign sfha_zone (FLD_ZONE) and
//    firm_panel (FIRM_PAN). This is the "point-in-polygon in the script"
//    the task calls for (preprocessing — allowed; the serving path in
//    src/core/registry never does this). A parcel whose centroid falls
//    outside every fetched zone/panel polygon (edge of the envelope, or
//    simply outside NFHL's mapped area) gets sfha_zone/firm_panel left
//    NULL — never guessed as "X" or any other value.
// 4. Map PROPCLASS -> occupancy_type per dlgf-property-classes.md's
//    documented ranges (see mapOccupancyType() below for the exact
//    reasoning and the explicit NULL cases).
// 5. Upsert into `structures` for the "Demo City" jurisdiction (T-C1's
//    seed), idempotent on the schema's own `unique (jurisdiction_id,
//    parcel_id)` constraint (ON CONFLICT ... DO UPDATE), so this script is
//    safely re-runnable.
//
// DB CONNECTION: plain `pg` connection (superuser DATABASE_URL), same
// pattern as scripts/db/seed.mjs — NOT withSystem()/withTenant() from
// src/shared/db. Reasoning: this is a batch/ops script (like seed.mjs and
// migrate.mjs), not app request-path code; it runs before any user session
// exists and needs no per-request jurisdiction scoping (there is exactly
// one jurisdiction, looked up by name, for the whole run). Importing a
// TypeScript module tree from src/shared into a plain .mjs preprocessing
// script would also cross a boundary nothing else in scripts/ crosses.
// RLS's FORCE ROW LEVEL SECURITY does not apply to the superuser connection
// this script (like seed.mjs) uses, by the same documented Postgres rule
// src/shared/db/client.ts explains for withTenant()'s SET LOCAL ROLE step.
//
// VALUES: per specs/core/tasks.md / docs/BLOCKERS.md B3 — there is no
// market-value field in the source data (hamilton-county-parcels.md
// "Gaps" #1). assessor_market_value is left NULL, never backfilled from
// AVTOTGROSS or any other field. improvement_value = AVIMPROVE.
// value_source = 'assessed_improvement' (matches schema/core.sql's allowed
// value_source enum). value_as_of_date is derived from AVTAXYR (the tax
// year the AV* fields apply to) as `${AVTAXYR}-01-01` — AVTAXYR is a bare
// year, not a specific calendar date, so January 1 of that year is used as
// the as-of date; this is a labeling convention for an already-real number,
// not a fabricated adjustment.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// --full (or INGEST_MODE=full) switches every fetch below from the
// Noblesville envelope to the whole county — see "FULL-COUNTY MODE" header
// comment. Each mode gets its own cache subdirectory so a bbox-mode cache
// (still used by test/e2e/registry.spec.ts's real-address fixture
// expectations) is never confused with a full-county one.
const FULL_MODE = process.argv.includes("--full") || process.env.INGEST_MODE === "full";
const cacheDir = path.join(repoRoot, "data/raw/ingest", FULL_MODE ? "_full" : ".");

const PARCELS_URL =
  "https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer/0/query";
const NFHL_ZONES_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";
const NFHL_PANELS_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/3/query";
const DFIRM_ID = "18057C"; // Hamilton County, IN — verified fema-nfhl.md

// WGS84 lon/lat envelope around downtown Noblesville / the White River
// corridor — see header comment above for how this was chosen. Only used
// when FULL_MODE is false.
const BBOX = "-86.03,40.03,-85.99,40.06";

const PAGE_SIZE = 1000; // well under maxRecordCount 2000 (hamilton-county-parcels.md)
const PAGE_DELAY_MS = 350; // polite delay between pages
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 500;
const DB_BATCH_SIZE = 500; // rows per multi-row upsert statement in full mode

const PARCEL_OUT_FIELDS = [
  "PARCELNO",
  "LOCADDRESS",
  "AVLAND",
  "AVIMPROVE",
  "AVTOTGROSS",
  "AVTAXYR",
  "PROPCLASS",
  "PROPUSE",
  "sq_ft_res",
  "sq_ft_comm",
  "year_built",
  "num_floors",
].join(",");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, params, { attempt = 1 } = {}) {
  const qs = new URLSearchParams(params);
  const fullUrl = `${url}?${qs.toString()}`;
  try {
    const res = await fetch(fullUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (json.error) {
      throw new Error(`ArcGIS error: ${JSON.stringify(json.error)}`);
    }
    return json;
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`Failed after ${attempt} attempts: ${url} — ${err.message}`);
    }
    const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
    console.warn(`  retry ${attempt}/${MAX_RETRIES - 1} for ${url} in ${backoff}ms (${err.message})`);
    await sleep(backoff);
    return fetchJsonWithRetry(url, params, { attempt: attempt + 1 });
  }
}

function readCache(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeCache(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data), "utf8");
}

/**
 * DB-write checkpoint, separate from the per-page fetch cache above. The
 * fetch cache alone makes a re-run skip network calls for already-fetched
 * pages, but every re-run still redid every earlier page's point-in-polygon
 * work and DB upsert from page 0 before reaching new pages — for
 * --full mode's ~154 pages that made each successive 10-minute foreground
 * invocation net LESS new progress than the last (quadratic re-work),
 * observed live 2026-08-18 (a second full-county run made zero net
 * progress past ~60,000 loaded rows in a full 10-minute window). This
 * checkpoint records the highest page offset whose DB upsert has actually
 * committed, keyed by a hash of the target DATABASE_URL (local dev and live
 * Supabase are different databases with independent progress) so a re-run
 * against the SAME database skips straight to the first un-upserted page.
 */
function checkpointFile(connectionString) {
  const dbLabel = createHash("sha256").update(connectionString).digest("hex").slice(0, 12);
  return path.join(cacheDir, `upsert_checkpoint_${dbLabel}.json`);
}

function readCheckpoint(connectionString) {
  const data = readCache(checkpointFile(connectionString));
  return data?.lastCompletedOffset ?? -1;
}

function writeCheckpoint(connectionString, offset) {
  writeCache(checkpointFile(connectionString), { lastCompletedOffset: offset, updatedAt: new Date().toISOString() });
}

/**
 * Pages the parcel FeatureServer — the BBOX envelope in default mode, the
 * whole county (`where=1=1`, no geometry filter) in --full mode — calling
 * `onPage(features, { offset, page })` once per page as soon as it is
 * available, rather than accumulating every feature in memory first. For
 * --full mode's ~154 pages of full polygon geometry that matters (avoids
 * holding the whole county's ring geometry in memory at once); it is a
 * harmless no-op difference for bbox mode's 4 pages. Each page is cached to
 * disk before onPage runs, so a re-run after an interruption (10-minute
 * foreground cap) skips every already-fetched page and resumes paging from
 * the first missing offset — the "checkpoint via resultOffset" behavior.
 */
async function fetchParcelsPaged(onPage) {
  let offset = 0;
  let page = 0;
  let total = 0;

  while (true) {
    const cacheFile = path.join(cacheDir, "parcels", `page_${offset}.json`);
    let json = readCache(cacheFile);

    if (json) {
      console.log(`  page ${page} (offset ${offset}): cached (${json.features.length} features)`);
    } else {
      const params = FULL_MODE
        ? {
            where: "1=1",
            outFields: PARCEL_OUT_FIELDS,
            returnGeometry: "true",
            outSR: "4326",
            resultOffset: String(offset),
            resultRecordCount: String(PAGE_SIZE),
            f: "json",
          }
        : {
            geometry: BBOX,
            geometryType: "esriGeometryEnvelope",
            inSR: "4326",
            spatialRel: "esriSpatialRelIntersects",
            outFields: PARCEL_OUT_FIELDS,
            returnGeometry: "true",
            outSR: "4326",
            resultOffset: String(offset),
            resultRecordCount: String(PAGE_SIZE),
            f: "json",
          };
      json = await fetchJsonWithRetry(PARCELS_URL, params);
      writeCache(cacheFile, json);
      console.log(`  page ${page} (offset ${offset}): fetched (${json.features.length} features)`);
      await sleep(PAGE_DELAY_MS);
    }

    total += json.features.length;
    await onPage(json.features, { offset, page });

    const exceeded = json.exceededTransferLimit === true;
    if (json.features.length < PAGE_SIZE && !exceeded) break;
    offset += json.features.length;
    page += 1;
    if (json.features.length === 0) break;
  }

  return total;
}

/**
 * Pages an NFHL layer (zones/panels), filtered to Hamilton County via
 * DFIRM_ID and, in bbox mode, the same envelope parcels use. Full-county
 * mode needs real paging here too — verified live 2026-08-18: 4,670 zone
 * features / 89 panel features county-wide vs. maxRecordCount 2000, where
 * bbox mode's original single-request assumption (146 zones / 4 panels for
 * that small envelope) held.
 */
async function fetchNfhlLayer(url, cacheName) {
  const features = [];
  let offset = 0;
  let page = 0;

  while (true) {
    const cacheFile = path.join(cacheDir, "nfhl", cacheName.replace(".json", ""), `page_${offset}.json`);
    let json = readCache(cacheFile);

    if (json) {
      console.log(`  ${cacheName} page ${page} (offset ${offset}): cached (${json.features.length} features)`);
    } else {
      const params = FULL_MODE
        ? {
            where: `DFIRM_ID='${DFIRM_ID}'`,
            outFields: "*",
            returnGeometry: "true",
            outSR: "4326",
            resultOffset: String(offset),
            resultRecordCount: String(PAGE_SIZE),
            f: "json",
          }
        : {
            where: `DFIRM_ID='${DFIRM_ID}'`,
            geometry: BBOX,
            geometryType: "esriGeometryEnvelope",
            inSR: "4326",
            spatialRel: "esriSpatialRelIntersects",
            outFields: "*",
            returnGeometry: "true",
            outSR: "4326",
            resultOffset: String(offset),
            resultRecordCount: String(PAGE_SIZE),
            f: "json",
          };
      json = await fetchJsonWithRetry(url, params);
      writeCache(cacheFile, json);
      console.log(`  ${cacheName} page ${page} (offset ${offset}): fetched (${json.features.length} features)`);
      await sleep(PAGE_DELAY_MS);
    }

    features.push(...json.features);
    const exceeded = json.exceededTransferLimit === true;
    if (json.features.length < PAGE_SIZE && !exceeded) break;
    offset += json.features.length;
    page += 1;
    if (json.features.length === 0) break;
  }

  return features;
}


// ---------------------------------------------------------------------
// Geometry helpers — plain JS, no new dependency.
// ---------------------------------------------------------------------

/** Area-weighted centroid of a polygon ring (shoelace formula). Falls back
 * to a simple vertex average for degenerate (near-zero-area) rings, e.g. a
 * single-point sliver. */
function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-12) {
    const n = ring.length;
    const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    return [sum[0] / n, sum[1] / n];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/** Representative point for an esri polygon geometry: the outer ring's
 * area-weighted centroid. Good enough for a point-in-flood-zone test; the
 * ingest does not need exact PostGIS-grade centroid math. */
function representativePoint(esriPolygon) {
  if (!esriPolygon || !esriPolygon.rings || esriPolygon.rings.length === 0) return null;
  return ringCentroid(esriPolygon.rings[0]);
}

/** Point-in-ring test via the standard ray-casting crossing-number test. */
function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon-with-holes via the even-odd rule summed across every
 * ring: XOR-ing point-in-ring across all rings gives the correct interior
 * test regardless of which rings are holes vs. outer boundaries (esri and
 * GeoJSON both rely on ring winding to distinguish holes, but even-odd
 * across all rings sidesteps needing to know the winding convention). */
function pointInEsriPolygon(point, esriPolygon) {
  if (!esriPolygon || !esriPolygon.rings) return false;
  let inside = false;
  for (const ring of esriPolygon.rings) {
    if (pointInRing(point, ring)) inside = !inside;
  }
  return inside;
}

/** Cheap axis-aligned bounding box for a feature's rings, computed once and
 * cached on the feature object. findContaining() below rejects a feature on
 * a bbox miss before paying for the full ray-casting test — full-county
 * mode point-in-polygon-tests every parcel against every NFHL zone (4,670
 * features county-wide, verified live 2026-08-18, vs. 146 for the original
 * Noblesville bbox), so this pre-filter is the difference between a run
 * that finishes and one that doesn't: without it this step is O(parcels x
 * zones x ring vertices), observed to make a 150k-parcel run stall for
 * multiple 10-minute foreground windows without completing one page's
 * worth of extra progress.
 */
function featureBbox(feature) {
  if (feature.__bbox !== undefined) return feature.__bbox;
  const rings = feature.geometry?.rings;
  if (!rings || rings.length === 0) {
    feature.__bbox = null;
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  feature.__bbox = [minX, minY, maxX, maxY];
  return feature.__bbox;
}

function findContaining(point, features, attrField) {
  const [px, py] = point;
  for (const feature of features) {
    const bbox = featureBbox(feature);
    if (!bbox) continue;
    const [minX, minY, maxX, maxY] = bbox;
    if (px < minX || px > maxX || py < minY || py > maxY) continue; // cheap reject
    if (pointInEsriPolygon(point, feature.geometry)) {
      return feature.attributes[attrField] ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// PROPCLASS -> occupancy_type, per docs/data-contracts/dlgf-property-classes.md
// ---------------------------------------------------------------------
//
// The contract's own "Recommendation" section: use 499 <= PROPCLASS <= 599
// as the residential signal, EXCLUDING codes DLGF classifies as commercial
// apartments (400, 401, 402) from any confident branch — the contract's
// "Gaps and risks" #2 explicitly flags that whether those apartment codes
// should route to SDE-residential or SDE-non-residential was NOT checked
// against the SDE manual's occupancy definitions, i.e. it is an open,
// unresolved question, not a settled one. Per AGENTS.md rule 4 / task
// constraint ("unknown/ambiguous classes -> occupancy_type NULL — never
// guess"), codes 400/401/402 are mapped to NULL here, not silently folded
// into non_residential just because they sit outside 499-599.
//
// Everything else in a documented DLGF range (100-398 agricultural/mineral/
// industrial, 399/403-498 commercial excluding the apartment codes above,
// 600-899 exempt/utility) maps to non_residential — these are unambiguous
// per the contract's Code List 1 table. A PROPCLASS outside every
// documented range, or null/unparseable, maps to NULL.
function mapOccupancyType(propClassRaw) {
  if (propClassRaw === null || propClassRaw === undefined) return null;
  const trimmed = String(propClassRaw).trim();
  if (trimmed === "") return null;
  const code = Number.parseInt(trimmed, 10);
  if (Number.isNaN(code)) return null;

  if (code === 400 || code === 401 || code === 402) return null; // ambiguous — see comment above

  if (code >= 499 && code <= 599) return "residential";

  if ((code >= 100 && code <= 398) || (code >= 399 && code <= 498) || (code >= 600 && code <= 899)) {
    return "non_residential";
  }

  return null; // outside every documented DLGF range — do not guess
}

/** num_floors arrives as a string with a trailing space, e.g. "1.0 "
 * (hamilton-county-parcels.md Gap #3) — trim and parse, never assume
 * integer type. Returns an integer story count, or null if unparseable. */
function parseStories(numFloorsRaw) {
  if (numFloorsRaw === null || numFloorsRaw === undefined) return null;
  const trimmed = String(numFloorsRaw).trim();
  if (trimmed === "") return null;
  const parsed = Number.parseFloat(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.round(parsed);
}

function pickSqFt(occupancyType, sqFtRes, sqFtComm) {
  if (occupancyType === "residential") return sqFtRes ?? sqFtComm ?? null;
  if (occupancyType === "non_residential") return sqFtComm ?? sqFtRes ?? null;
  return sqFtRes ?? sqFtComm ?? null;
}

const STRUCTURE_COLUMNS = [
  "jurisdiction_id",
  "parcel_id",
  "address",
  "geom_lng",
  "geom_lat",
  "improvement_value",
  "value_as_of_date",
  "sfha_zone",
  "firm_panel",
  "occupancy_type",
  "stories",
  "sq_ft",
  "year_built",
  "prop_class",
];

/** Builds one multi-row `insert ... on conflict do update` statement for up
 * to DB_BATCH_SIZE rows at a time — see "FULL-COUNTY MODE" header comment
 * for why row-at-a-time (bbox mode's original approach) doesn't scale to
 * 153,883 rows. `geom` is computed inline per row from the geom_lng/geom_lat
 * placeholder pair since ST_MakePoint isn't expressible as a plain VALUES
 * literal. */
function buildUpsertStatement(rowCount) {
  const cols = STRUCTURE_COLUMNS.length;
  const valueTuples = [];
  for (let r = 0; r < rowCount; r++) {
    const base = r * cols;
    const p = (i) => `$${base + i + 1}`;
    valueTuples.push(
      `(${p(0)}, ${p(1)}, ${p(2)}, case when ${p(3)}::double precision is null then null else ST_SetSRID(ST_MakePoint(${p(3)}, ${p(4)}), 4326) end, null, ${p(5)}, 'assessed_improvement', ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)})`,
    );
  }
  return `
    insert into structures (
      jurisdiction_id, parcel_id, address, geom,
      assessor_market_value, improvement_value, value_source, value_as_of_date,
      sfha_zone, firm_panel, occupancy_type, stories, sq_ft, year_built, prop_class
    ) values ${valueTuples.join(",\n")}
    on conflict (jurisdiction_id, parcel_id) do update set
      address = excluded.address,
      geom = excluded.geom,
      improvement_value = excluded.improvement_value,
      value_source = excluded.value_source,
      value_as_of_date = excluded.value_as_of_date,
      sfha_zone = excluded.sfha_zone,
      firm_panel = excluded.firm_panel,
      occupancy_type = coalesce(structures.occupancy_type, excluded.occupancy_type),
      stories = excluded.stories,
      sq_ft = excluded.sq_ft,
      year_built = excluded.year_built,
      prop_class = excluded.prop_class
    returning (xmax = 0) as inserted`;
}

async function main() {
  console.log(
    FULL_MODE
      ? "Mode: FULL COUNTY (--full) — no geometry filter, all 153,883 parcels."
      : `Mode: bbox ${BBOX} (WGS84 lon/lat) — see script header for derivation. Pass --full for the whole county.`,
  );

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("BLOCKER: DATABASE_URL is not set. See .env.example.");
    process.exit(1);
  }

  console.log("\nFetching NFHL layers (FEMA hazards.fema.gov) ...");
  const zoneFeatures = await fetchNfhlLayer(NFHL_ZONES_URL, "zones");
  const panelFeatures = await fetchNfhlLayer(NFHL_PANELS_URL, "panels");
  console.log(`NFHL zones: ${zoneFeatures.length}, panels: ${panelFeatures.length}`);

  const client = new pg.Client({ connectionString });
  await client.connect();

  let jurisdictionId;
  try {
    const jurisdictionResult = await client.query(
      "select id from jurisdictions where name = $1",
      ["Demo City"],
    );
    if (jurisdictionResult.rows.length === 0) {
      console.error(
        'BLOCKER: no "Demo City" jurisdiction found. Run `pnpm db:seed` first (T-C1).',
      );
      process.exit(1);
    }
    jurisdictionId = jurisdictionResult.rows[0].id;
    console.log(`\nLoading into jurisdiction Demo City (${jurisdictionId}) ...`);

    let totalFetched = 0;
    let inserted = 0;
    let updated = 0;
    let skippedNoParcelId = 0;
    let skippedNoAddress = 0;
    let occupancyNullCount = 0;
    let sfhaAssignedCount = 0;
    const sampleAddresses = [];

    const resumeFromOffset = readCheckpoint(connectionString);
    if (resumeFromOffset >= 0) {
      console.log(
        `\nResuming: DB upsert checkpoint found, skipping pages already committed up through offset ${resumeFromOffset}.`,
      );
    }

    console.log("\nFetching + loading parcels (Hamilton County FeatureServer, Layer 0) ...");

    await fetchParcelsPaged(async (features, { page, offset }) => {
      totalFetched += features.length;

      if (offset <= resumeFromOffset) {
        console.log(`  page ${page} (offset ${offset}): already committed (checkpoint), skipping DB work`);
        return;
      }

      const rows = [];

      for (const feature of features) {
        const attrs = feature.attributes;
        const parcelId = attrs.PARCELNO;
        const address = attrs.LOCADDRESS;

        if (!parcelId) {
          skippedNoParcelId += 1;
          continue;
        }
        if (!address) {
          skippedNoAddress += 1;
          continue;
        }

        const point = representativePoint(feature.geometry);
        let sfhaZone = null;
        let firmPanel = null;
        if (point) {
          sfhaZone = findContaining(point, zoneFeatures, "FLD_ZONE");
          firmPanel = findContaining(point, panelFeatures, "FIRM_PAN");
          if (sfhaZone !== null) sfhaAssignedCount += 1;
        }

        const occupancyType = mapOccupancyType(attrs.PROPCLASS);
        if (occupancyType === null) occupancyNullCount += 1;

        const stories = parseStories(attrs.num_floors);
        const sqFt = pickSqFt(occupancyType, attrs.sq_ft_res, attrs.sq_ft_comm);
        const improvementValue = typeof attrs.AVIMPROVE === "number" ? attrs.AVIMPROVE : null;
        const valueAsOfDate = typeof attrs.AVTAXYR === "number" ? `${attrs.AVTAXYR}-01-01` : null;

        rows.push([
          jurisdictionId,
          parcelId,
          address,
          point ? point[0] : null,
          point ? point[1] : null,
          improvementValue,
          valueAsOfDate,
          sfhaZone,
          firmPanel,
          occupancyType,
          stories,
          sqFt,
          attrs.year_built ?? null,
          attrs.PROPCLASS ?? null,
        ]);

        if (sampleAddresses.length < 3) sampleAddresses.push(address);
      }

      // A single multi-row `ON CONFLICT DO UPDATE` statement errors
      // ("cannot affect row a second time") if two VALUES rows share a
      // conflict target — and the live county service does occasionally
      // return the same PARCELNO twice within one 1000-row page (observed
      // live 2026-08-18, full-county run, around offset 38000). De-dupe by
      // parcel_id within each batch before upserting, keeping the LAST
      // occurrence (same "last write wins" semantics ON CONFLICT DO UPDATE
      // itself would give across separate statements) — this is a batching
      // artifact fix, not a change to what data ends up stored.
      const dedupedByParcelId = new Map();
      for (const row of rows) {
        dedupedByParcelId.set(row[1], row); // row[1] = parcel_id
      }
      const dedupedRows = [...dedupedByParcelId.values()];
      const duplicatesInPage = rows.length - dedupedRows.length;
      if (duplicatesInPage > 0) {
        console.log(`  page ${page}: ${duplicatesInPage} duplicate PARCELNO within this page, kept last occurrence`);
      }

      // Upsert in DB_BATCH_SIZE-row chunks within this page.
      for (let i = 0; i < dedupedRows.length; i += DB_BATCH_SIZE) {
        const chunk = dedupedRows.slice(i, i + DB_BATCH_SIZE);
        const stmt = buildUpsertStatement(chunk.length);
        const params = chunk.flat();
        const result = await client.query(stmt, params);
        for (const r of result.rows) {
          if (r.inserted) inserted += 1;
          else updated += 1;
        }
      }

      // Only checkpoint after the page's upserts have actually committed
      // (we're past the `await client.query` calls above) — a checkpoint
      // written before the commit could skip a page that never made it in.
      writeCheckpoint(connectionString, offset);

      console.log(
        `  page ${page}: ${features.length} fetched, ${rows.length} loaded (running total loaded: ${inserted + updated})`,
      );
    });

    console.log("\n--- Ingest summary ---");
    console.log(`Mode: ${FULL_MODE ? "full county" : "bbox"}`);
    console.log(`Parcels fetched from live service: ${totalFetched}`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated (already existed, re-run): ${updated}`);
    console.log(`Total loaded rows: ${inserted + updated}`);
    console.log(`Skipped (no PARCELNO): ${skippedNoParcelId}`);
    console.log(`Skipped (no LOCADDRESS): ${skippedNoAddress}`);
    console.log(`occupancy_type left NULL (unknown/ambiguous PROPCLASS): ${occupancyNullCount}`);
    console.log(`sfha_zone assigned (point fell inside a fetched NFHL zone polygon): ${sfhaAssignedCount}`);
    console.log(`Sample addresses: ${sampleAddresses.join(" | ")}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
