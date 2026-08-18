// Live, single-parcel lookups against the Hamilton County parcel
// FeatureServer, used by the enrichment ("Refresh from county records")
// feature — F1 registry task.
//
// AGENTS.md "Geospatial" reserves raster work and spatial JOINS for
// scripts/preprocess/; it does NOT forbid a single-feature attribute lookup
// (`where PARCELNO=$1`, no geometry, no join) at request time — this file
// does no polygon math and touches no raster. It is the same kind of read
// src/core/registry/queries.ts already does against the precomputed `geom`
// column (see that file's nearestStructures() comment for the same
// reasoning applied to PostGIS distance). Documented again in
// docs/journal/2026-08-18-f1-registry.md per the task brief.
//
// Every field name below is verbatim from
// docs/data-contracts/hamilton-county-parcels.md — same contract
// scripts/preprocess/ingest-parcels.mjs uses. The mapping helpers
// (mapOccupancyType/parseStories/pickSqFt) are intentionally a second,
// independent copy of that script's logic rather than a shared import:
// ingest-parcels.mjs is a plain .mjs preprocessing script that deliberately
// does not import the src/ TypeScript tree (see its own header comment), so
// there is no existing shared module to import from without crossing that
// boundary. Keep the two in sync by hand if either changes; both are small
// and each cites the same source contract in comments.
import type { EnrichableField, EnrichmentSuggestion, OccupancyType } from "./types";

const PARCELS_URL =
  "https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCoParcelsPublic/FeatureServer/0/query";

const OUT_FIELDS = [
  "PARCELNO",
  "LOCADDRESS",
  "AVIMPROVE",
  "PROPCLASS",
  "sq_ft_res",
  "sq_ft_comm",
  "year_built",
  "num_floors",
].join(",");

// Single-lookup timeout: this call happens inline in a request the assessor
// is waiting on (or a background auto-suggest on page load) — never let a
// slow/hung county service block the page indefinitely. A timeout here is
// the "degrade silently to manual entry" path the task calls for.
const FETCH_TIMEOUT_MS = 6000;

export interface HamcoParcelRecord {
  parcelNo: string;
  avImprove: number | null;
  propClass: string | null;
  sqFtRes: number | null;
  sqFtComm: number | null;
  yearBuilt: number | null;
  numFloors: string | null;
}

/** Same reasoning as dlgf-property-classes.md's "Recommendation" section and
 * scripts/preprocess/ingest-parcels.mjs's mapOccupancyType(): 499-599 is the
 * residential DLGF range; 400/401/402 (commercial apartment codes) are left
 * NULL as an unresolved ambiguity, never guessed. */
export function mapOccupancyType(propClassRaw: string | null): OccupancyType | null {
  if (propClassRaw === null) return null;
  const trimmed = propClassRaw.trim();
  if (trimmed === "") return null;
  const code = Number.parseInt(trimmed, 10);
  if (Number.isNaN(code)) return null;
  if (code === 400 || code === 401 || code === 402) return null;
  if (code >= 499 && code <= 599) return "residential";
  if ((code >= 100 && code <= 398) || (code >= 399 && code <= 498) || (code >= 600 && code <= 899)) {
    return "non_residential";
  }
  return null;
}

/** num_floors arrives as a string with a trailing space, e.g. "1.0 "
 * (hamilton-county-parcels.md Gap #3). */
export function parseStories(numFloorsRaw: string | null): number | null {
  if (numFloorsRaw === null) return null;
  const trimmed = numFloorsRaw.trim();
  if (trimmed === "") return null;
  const parsed = Number.parseFloat(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.round(parsed);
}

export function pickSqFt(
  occupancyType: OccupancyType | null,
  sqFtRes: number | null,
  sqFtComm: number | null,
): number | null {
  if (occupancyType === "residential") return sqFtRes ?? sqFtComm ?? null;
  if (occupancyType === "non_residential") return sqFtComm ?? sqFtRes ?? null;
  return sqFtRes ?? sqFtComm ?? null;
}

/**
 * Fetches the single live parcel record for `parcelId` (PARCELNO). Returns
 * null on ANY failure (network, timeout, non-2xx, malformed body, zero
 * matches) — callers must treat null as "unavailable, fall back to manual
 * entry," never as an error to surface. This is the "degrade silently"
 * behavior the task requires; offline-first rules apply to the field flow.
 */
export async function fetchCountyParcelRecord(parcelId: string): Promise<HamcoParcelRecord | null> {
  if (!parcelId || parcelId.startsWith("MANUAL-")) return null; // no real PARCELNO to look up

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      where: `PARCELNO='${parcelId.replace(/'/g, "''")}'`,
      outFields: OUT_FIELDS,
      returnGeometry: "false",
      f: "json",
    });
    const res = await fetch(`${PARCELS_URL}?${params.toString()}`, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      error?: unknown;
      features?: Array<{ attributes: Record<string, unknown> }>;
    };
    const feature = json.features?.[0];
    if (json.error || !feature) return null;

    const attrs = feature.attributes;
    return {
      parcelNo: String(attrs.PARCELNO ?? parcelId),
      avImprove: typeof attrs.AVIMPROVE === "number" ? attrs.AVIMPROVE : null,
      propClass: attrs.PROPCLASS === null || attrs.PROPCLASS === undefined ? null : String(attrs.PROPCLASS),
      sqFtRes: typeof attrs.sq_ft_res === "number" ? attrs.sq_ft_res : null,
      sqFtComm: typeof attrs.sq_ft_comm === "number" ? attrs.sq_ft_comm : null,
      yearBuilt: typeof attrs.year_built === "number" ? attrs.year_built : null,
      numFloors: attrs.num_floors === null || attrs.num_floors === undefined ? null : String(attrs.num_floors),
    };
  } catch {
    return null; // network error, abort/timeout, JSON parse failure — all "unavailable"
  } finally {
    clearTimeout(timeout);
  }
}

interface CurrentValues {
  improvementValue: number | null;
  sqFt: number | null;
  yearBuilt: number | null;
  stories: number | null;
  occupancyType: OccupancyType | null;
  propClass: string | null;
}

const FIELD_LABELS: Record<EnrichableField, string> = {
  improvementValue: "Improvement value",
  sqFt: "Square footage",
  yearBuilt: "Year built",
  stories: "Stories",
  occupancyType: "Occupancy",
  propClass: "DLGF property class",
};

/**
 * Builds suggestions ONLY for fields currently null on the structure — the
 * "never overwrite an existing user-entered value automatically" rule is
 * enforced here at the suggestion stage (nothing to accept for an already-
 * populated field) and again in queries.ts's applyEnrichment (a NULL guard
 * on the UPDATE itself, defense in depth against a race).
 */
export function buildEnrichmentSuggestions(
  current: CurrentValues,
  record: HamcoParcelRecord,
  fetchedAtIso: string,
): EnrichmentSuggestion[] {
  const fetchedDate = fetchedAtIso.slice(0, 10);
  const sourceLabel = `County assessor record, fetched ${fetchedDate}`;
  const suggestions: EnrichmentSuggestion[] = [];

  const occupancyType = current.occupancyType ?? mapOccupancyType(record.propClass);
  const stories = parseStories(record.numFloors);
  const sqFt = pickSqFt(occupancyType, record.sqFtRes, record.sqFtComm);

  function maybeAdd(field: EnrichableField, currentValue: unknown, suggestedValue: string | number | null) {
    if (currentValue !== null && currentValue !== undefined) return; // already on file — never suggest a change
    if (suggestedValue === null || suggestedValue === undefined) return; // source has nothing either
    suggestions.push({ field, suggestedValue, label: FIELD_LABELS[field], sourceLabel });
  }

  maybeAdd("improvementValue", current.improvementValue, record.avImprove);
  maybeAdd("sqFt", current.sqFt, sqFt);
  maybeAdd("yearBuilt", current.yearBuilt, record.yearBuilt);
  maybeAdd("stories", current.stories, stories);
  maybeAdd("occupancyType", current.occupancyType, occupancyType);
  maybeAdd("propClass", current.propClass, record.propClass);

  return suggestions;
}
