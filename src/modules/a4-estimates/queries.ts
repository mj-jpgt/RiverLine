// Read-only queries for the A4 estimates module. Every query is
// jurisdiction-scoped through withTenant() (RLS-enforced) — same pattern
// every other module/core family in this codebase uses
// (src/core/determination/queries.ts, src/modules/a1-letters/queries.ts).
import type { PoolClient } from "pg";
import { withTenant } from "@/shared/db";
import { checkSanityBound } from "./parser";
import type {
  AssessmentEstimatesContext,
  ConfirmedLineItem,
  EstimateDetail,
  EstimatePageStorage,
  EstimateProvenance,
  EstimateVersionSummary,
  ExtractedJson,
} from "./types";

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parsePages(storageKey: string): EstimatePageStorage[] {
  // storage_key is JSON.stringify(string[]) written only by
  // actions.ts's createEstimateVersion — see types.ts's "Multi-page
  // documents" doc comment. Parsed defensively (never throw into a page
  // render for a malformed/legacy row); a page-level sha256 isn't
  // separately persisted per element, so it's re-derived from the storage
  // key filename (`<jurisdictionId>/estimates/<sha256>.jpg`) which is
  // exactly what actions.ts wrote it as.
  try {
    const keys = JSON.parse(storageKey) as unknown;
    if (!Array.isArray(keys)) return [];
    return keys
      .filter((k): k is string => typeof k === "string")
      .map((storageKeyForPage) => {
        const fileName = storageKeyForPage.split("/").pop() ?? "";
        const sha256 = fileName.replace(/\.jpg$/i, "");
        return { storageKey: storageKeyForPage, sha256 };
      });
  } catch {
    return [];
  }
}

function parseConfirmedLineItems(raw: unknown): ConfirmedLineItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: ConfirmedLineItem[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).description === "string" &&
      typeof (entry as Record<string, unknown>).amountDollars === "number"
    ) {
      items.push({
        description: (entry as Record<string, unknown>).description as string,
        amountDollars: (entry as Record<string, unknown>).amountDollars as number,
      });
    }
  }
  return items;
}

interface EstimateRow {
  id: string;
  assessment_id: string;
  version: number;
  supersedes_estimate_id: string | null;
  storage_key: string;
  original_filename: string | null;
  ocr_engine: string | null;
  ocr_engine_version: string | null;
  extracted_json: unknown;
  confirmed_total: string | null;
  confirmed_line_items: unknown;
  scope_reviewed: boolean;
  confirmed_by_user_id: string | null;
  confirmed_by_email: string | null;
  confirmed_at: unknown;
  notes: string | null;
  created_at: unknown;
}

function toSummary(row: EstimateRow, improvementValue: number | null): EstimateVersionSummary {
  const confirmedTotal = row.confirmed_total !== null ? Number(row.confirmed_total) : null;
  const isConfirmed = row.confirmed_at !== null;
  const confirmedLineItems = parseConfirmedLineItems(row.confirmed_line_items);
  const provenance: EstimateProvenance | null = isConfirmed
    ? row.extracted_json !== null
      ? "ocr_assisted"
      : "manual_entry"
    : null;
  const sanity = confirmedTotal !== null ? checkSanityBound(confirmedTotal, improvementValue) : { exceedsBound: null };
  const pages = parsePages(row.storage_key);

  return {
    id: row.id,
    assessmentId: row.assessment_id,
    version: row.version,
    supersedesEstimateId: row.supersedes_estimate_id,
    originalFilename: row.original_filename,
    pageCount: pages.length,
    ocrEngine: row.ocr_engine,
    ocrEngineVersion: row.ocr_engine_version,
    hasExtraction: row.extracted_json !== null,
    isConfirmed,
    provenance,
    confirmedTotal,
    confirmedLineItems,
    scopeReviewed: row.scope_reviewed,
    confirmedByEmail: row.confirmed_by_email,
    confirmedAtIso: row.confirmed_at ? toIso(row.confirmed_at) : null,
    notes: row.notes,
    createdAtIso: toIso(row.created_at),
    sanityFlag: sanity.exceedsBound === true,
  };
}

const ESTIMATE_SELECT = `
  select e.id, e.assessment_id, e.version, e.supersedes_estimate_id, e.storage_key,
         e.original_filename, e.ocr_engine, e.ocr_engine_version, e.extracted_json,
         e.confirmed_total, e.confirmed_line_items, e.scope_reviewed,
         e.confirmed_by_user_id, u.email as confirmed_by_email, e.confirmed_at,
         e.notes, e.created_at
  from estimates e
  left join users u on u.id = e.confirmed_by_user_id
`;

/** Full context for the "estimates for one assessment" page
 * (app/estimates/[clientId]) — structure address + improvement value (for
 * the sanity-bound display) + every estimate version, newest first. */
export async function getAssessmentEstimatesContext(
  jurisdictionId: string,
  userId: string | null,
  clientId: string,
): Promise<AssessmentEstimatesContext | null> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(
      `select a.id as assessment_id, s.address, s.improvement_value
       from assessments a
       join structures s on s.id = a.structure_id
       where a.client_id = $1`,
      [clientId],
    );
    if (assessmentRes.rows.length === 0) return null;
    const row = assessmentRes.rows[0] as {
      assessment_id: string;
      address: string;
      improvement_value: string | null;
    };
    const improvementValue = row.improvement_value !== null ? Number(row.improvement_value) : null;

    const estimatesRes = await client.query<EstimateRow>(
      `${ESTIMATE_SELECT} where e.assessment_id = $1 order by e.version desc`,
      [row.assessment_id],
    );

    return {
      assessmentId: row.assessment_id,
      clientId,
      structureAddress: row.address,
      structureImprovementValue: improvementValue,
      versions: estimatesRes.rows.map((r) => toSummary(r, improvementValue)),
    };
  });
}

/** Single estimate, with parsed pages + full extracted_json — for the
 * confirmation flow (needs the raw OCR output to render candidate rows). */
export async function getEstimateDetail(
  jurisdictionId: string,
  userId: string | null,
  estimateId: string,
): Promise<EstimateDetail | null> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const res = await client.query<EstimateRow & { improvement_value: string | null }>(
      `select e.id, e.assessment_id, e.version, e.supersedes_estimate_id, e.storage_key,
              e.original_filename, e.ocr_engine, e.ocr_engine_version, e.extracted_json,
              e.confirmed_total, e.confirmed_line_items, e.scope_reviewed,
              e.confirmed_by_user_id, u.email as confirmed_by_email, e.confirmed_at,
              e.notes, e.created_at, s.improvement_value as improvement_value
       from estimates e
       join assessments a on a.id = e.assessment_id
       join structures s on s.id = a.structure_id
       left join users u on u.id = e.confirmed_by_user_id
       where e.id = $1`,
      [estimateId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const improvementValue = row.improvement_value !== null ? Number(row.improvement_value) : null;
    const summary = toSummary(row, improvementValue);
    return {
      ...summary,
      pages: parsePages(row.storage_key),
      extracted: (row.extracted_json as ExtractedJson | null) ?? null,
    };
  });
}

/** Reads back an estimate page's bytes off disk — same content-addressed
 * uploads/<jurisdictionId>/estimates/<sha256>.jpg convention
 * app/api/capture/sync/route.ts already uses for photos. */
export async function resolveEstimatePageStorageKey(
  jurisdictionId: string,
  userId: string | null,
  estimateId: string,
  pageIndex: number,
): Promise<string | null> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const res = await client.query(`select storage_key from estimates where id = $1`, [estimateId]);
    if (res.rows.length === 0) return null;
    const pages = parsePages(res.rows[0].storage_key as string);
    return pages[pageIndex]?.storageKey ?? null;
  });
}

export interface AssessmentListRow {
  clientId: string;
  address: string;
  completedAtIso: string | null;
  estimateCount: number;
}

/** Entry-point search/list for app/estimates/ (this module's own index
 * page) — no other agent's page links here yet (T-C5's determination
 * review screen would be the natural integration point; documented as an
 * open item in the journal since app/determination/ is out of scope for
 * this task). Lists completed assessments, optionally filtered by address
 * substring, most-recently-completed first. */
export async function searchAssessmentsForEstimates(
  jurisdictionId: string,
  userId: string | null,
  addressQuery: string | null,
): Promise<AssessmentListRow[]> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const res = await client.query(
      `select a.client_id, s.address, a.completed_at,
              (select count(*) from estimates e where e.assessment_id = a.id) as estimate_count
       from assessments a
       join structures s on s.id = a.structure_id
       where a.completed_at is not null
         and ($1::text is null or s.address ilike '%' || $1 || '%')
       order by a.completed_at desc
       limit 50`,
      [addressQuery && addressQuery.trim().length > 0 ? addressQuery.trim() : null],
    );
    return res.rows.map((r) => ({
      clientId: r.client_id as string,
      address: r.address as string,
      completedAtIso: r.completed_at ? toIso(r.completed_at) : null,
      estimateCount: Number(r.estimate_count),
    }));
  });
}
