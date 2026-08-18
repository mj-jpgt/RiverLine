// Public types for the A4 contractor-estimate intake module.
//
// Mirrors migrations/0005_contractor_estimates.sql's `estimates` table
// (additive, outside the frozen schema/core.sql — see that migration's file
// header). Every field here traces to a real column or to a documented,
// in-code decision about how a column is used (e.g. multi-page storage —
// see "Multi-page documents" below). Nothing invented.
//
// Central rule this whole module exists to enforce (build spec §8, framing
// paragraph): "Treat OCR as an assist that pre-fills fields a human
// confirms — never as a data source that commits values." `ExtractedJson`
// (raw OCR output) and the `confirmed_*` columns are two SEPARATE families
// of data on the same row for exactly this reason — see
// migrations/0005_contractor_estimates.sql's comment block.

export type Uuid = string;
export type IsoTimestamp = string;

/**
 * A single OCR-recognized text line, as produced by tesseract.js's
 * `recognize()` result (`data.lines[i]`) — text, a bounding box in the
 * SOURCE IMAGE's pixel space (so the confirmation UI can crop/highlight the
 * exact source region per spec §8 mitigation 1: "extracted values render
 * side-by-side with a crop of the source region"), and a 0-100 OCR
 * confidence score.
 */
export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLine {
  text: string;
  bbox: OcrBoundingBox;
  confidence: number;
}

/**
 * One candidate line item extracted from the document — spec §8 mitigation
 * 2 ("Wrong-number selection... extract the full line-item table, not a
 * single total"). `amountDollars` is null when the trailing token on the
 * line could not be parsed as money (parser.ts's `parseMoneyToDollars`
 * returns null) — the row still renders, with an honest "amount unreadable"
 * state, rather than being silently dropped.
 */
export interface CandidateLineItem {
  /** Stable within one extraction pass — `line-<sourceLineIndex>` — used as
   * the React key and as the id the confirmation UI reports back when a
   * human marks a specific row "verified." */
  id: string;
  description: string;
  amountRawText: string;
  amountDollars: number | null;
  confidence: number;
  bbox: OcrBoundingBox;
  sourceLineIndex: number;
  /** Which uploaded page this line came from (0-indexed) — see "Multi-page
   * documents" below. */
  pageIndex: number;
}

/**
 * A candidate TOTAL — a line whose text matched a total-ish keyword
 * ("total", "subtotal", "balance due", "amount due", "grand total",
 * "contract price", "sum"). Spec §8 mitigation 2 is explicit: "require the
 * human to tap the row that is the relevant total" — this list is never
 * auto-picked; `pure.ts`/the confirmation UI only ever narrows the
 * candidate set, a human always makes the final tap.
 */
export interface CandidateTotal {
  id: string;
  label: string;
  amountRawText: string;
  amountDollars: number | null;
  confidence: number;
  bbox: OcrBoundingBox;
  sourceLineIndex: number;
  pageIndex: number;
}

export interface ExtractedPage {
  pageIndex: number;
  imageWidthPx: number;
  imageHeightPx: number;
  fullText: string;
  lines: OcrLine[];
}

/**
 * The full raw OCR output for one estimate document (one or more pages),
 * stored verbatim in `estimates.extracted_json`. Never mutated after
 * insert — a re-run of OCR (e.g. a retake) is a NEW estimate version
 * (spec §8 mitigation 3), never an update to this JSON.
 */
export interface ExtractedJson {
  engine: "tesseract.js";
  engineVersion: string;
  extractedAtIso: IsoTimestamp;
  pages: ExtractedPage[];
  lineItems: CandidateLineItem[];
  candidateTotals: CandidateTotal[];
}

/** One page's client-processed image, ready to upload. */
export interface EstimatePageUpload {
  sha256: string;
  dataBase64: string;
  contentType: "image/jpeg";
  originalFilename: string | null;
  widthPx: number;
  heightPx: number;
}

/**
 * Multi-page documents (spec §8.2/build task: "multi-image for multi-page").
 * `estimates.storage_key` and `estimates.sha256` are single `text`/`char(64)`
 * columns (migration is the literal shape given for this task — not
 * editable). For a multi-page document this module stores:
 *   - `storage_key` = JSON.stringify(string[]) — the ordered list of each
 *     page's own content-addressed relative path
 *     (`<jurisdictionId>/estimates/<pageSha256>.jpg`), same convention
 *     `app/api/capture/sync/route.ts` already uses for photos.
 *   - `sha256` = sha256 of the page hashes joined with `,` in page order —
 *     a whole-DOCUMENT identity distinct from any single page's own hash,
 *     deterministic and re-verifiable server-side the same way a
 *     single-page hash is. Documented here, in
 *     `src/modules/a4-estimates/actions.ts`, and in the journal — same
 *     spirit as ADR 0006's documented `pdf_storage_key`-stores-HTML
 *     mismatch, not a silent repurposing.
 * A single-page upload still goes through this exact same path (a
 * one-element array) — there is only one code path, not a special case.
 */
export interface EstimatePageStorage {
  storageKey: string;
  sha256: string;
}

export type EstimateProvenance = "ocr_assisted" | "manual_entry";

export interface ConfirmedLineItem {
  description: string;
  amountDollars: number;
}

export interface EstimateVersionSummary {
  id: Uuid;
  assessmentId: Uuid;
  version: number;
  supersedesEstimateId: Uuid | null;
  originalFilename: string | null;
  pageCount: number;
  ocrEngine: string | null;
  ocrEngineVersion: string | null;
  hasExtraction: boolean;
  isConfirmed: boolean;
  provenance: EstimateProvenance | null;
  confirmedTotal: number | null;
  confirmedLineItems: ConfirmedLineItem[] | null;
  scopeReviewed: boolean;
  confirmedByEmail: string | null;
  confirmedAtIso: IsoTimestamp | null;
  notes: string | null;
  createdAtIso: IsoTimestamp;
  sanityFlag: boolean;
}

export interface EstimateDetail extends EstimateVersionSummary {
  pages: EstimatePageStorage[];
  extracted: ExtractedJson | null;
}

export interface AssessmentEstimatesContext {
  assessmentId: Uuid;
  clientId: string;
  structureAddress: string;
  structureImprovementValue: number | null;
  versions: EstimateVersionSummary[];
}

export interface CreateEstimateInput {
  pages: EstimatePageUpload[];
  extracted: ExtractedJson | null;
}

export type CreateEstimateResult =
  | { status: "ok"; estimateId: Uuid; version: number }
  | { status: "not_found" }
  | { status: "hash_mismatch"; pageIndex: number }
  | { status: "too_large"; pageIndex: number }
  | { status: "invalid_image_type"; pageIndex: number };

export interface ConfirmEstimateInput {
  confirmedTotal: number;
  confirmedLineItems: ConfirmedLineItem[];
  scopeReviewed: boolean;
  provenance: EstimateProvenance;
  notes: string | null;
}

export type ConfirmEstimateResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "already_confirmed" }
  | { status: "scope_not_reviewed" }
  | { status: "invalid_total" };
