// Pure parsing/reconciliation logic for A4 OCR estimate intake. No I/O, no
// tesseract.js import here (that lives in ocr.client.ts, browser-only) — this
// file is plain, unit-testable TypeScript, same separation
// src/core/determination/pure.ts and src/modules/a1-letters/pure.ts already
// use.
//
// This is the file build spec §8's numbered failure modes are actually
// mitigated in, so every exported function below is annotated with which
// mitigation it implements.
import type { CandidateLineItem, CandidateTotal, OcrLine } from "./types";

// ---------------------------------------------------------------------------
// Mitigation §8.6 — "Unit and currency artifacts. '$12,500.00' read as
// '1250000'." A naive strip-all-non-digits parse loses the decimal point
// along with the thousands separator and silently inflates the value 100x.
// This function keeps the decimal point and the thousands separators
// strictly distinct: only a comma preceded by exactly 3 digits (a real
// thousands group) is ever removed; the decimal point is never touched.
// ---------------------------------------------------------------------------

const STRICT_MONEY_BODY =
  /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/;

/**
 * Parses a single money-looking string into a dollar amount (a plain JS
 * number, matching how this codebase already represents
 * numeric(12,2)/numeric(6,4) columns elsewhere — e.g.
 * src/shared/types.ts's `Calculation.total_repair_cost`). Returns null
 * (never a guess) if the string is not unambiguously a money value.
 *
 * THE unit-tested case from spec §8.6: parseMoneyToDollars("$12,500.00")
 * must equal 12500, never 1250000.
 */
export function parseMoneyToDollars(raw: string): number | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.length === 0) return null;

  // Accounting-style negatives: "(1,200.00)".
  let negative = false;
  const parenMatch = /^\((.*)\)$/.exec(s);
  if (parenMatch && parenMatch[1] !== undefined) {
    negative = true;
    s = parenMatch[1].trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }

  // Strip a leading currency symbol and any whitespace after it. Only `$`
  // is in scope — this project's domain (FEMA/Indiana municipal contractor
  // estimates) is USD-only; never invent support for other currencies.
  s = s.replace(/^\$\s*/, "").trim();

  if (!STRICT_MONEY_BODY.test(s)) return null;

  // Remove thousands-separator commas ONLY — the decimal point (if any) is
  // untouched by this replace, since STRICT_MONEY_BODY has already proven
  // every comma in `s` sits between digit groups of exactly 3, never
  // adjacent to the decimal point.
  const withoutThousands = s.replace(/,/g, "");
  const value = Number(withoutThousands);
  if (!Number.isFinite(value)) return null;

  return negative ? -value : value;
}

/** Converts a dollar amount to integer cents for exact-integer arithmetic
 * (reconciliation sums must never accumulate floating-point drift). */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

// ---------------------------------------------------------------------------
// Mitigation §8.2 — "Wrong-number selection... extract the full line-item
// table, not a single total; require the human to tap the row that is the
// relevant total." This module only NARROWS candidates by keyword; it never
// picks one. The confirmation UI (app/estimates) is the only place a total
// is ever selected, by an explicit tap.
// ---------------------------------------------------------------------------

const TOTAL_KEYWORDS =
  /\b(grand\s*total|sub\s*-?\s*total|total\s*due|balance\s*due|amount\s*due|contract\s*(price|amount|total)|total)\b/i;

// The trailing money-SHAPED token on a line — allow an optional leading
// `$`, and the same thousands-grouping/decimal shape STRICT_MONEY_BODY
// requires, but each digit position also accepts the common OCR
// digit/letter confusables (O/o for 0, I/l for 1) — spec §8 mitigation 4
// ("field conditions... wet, wrinkled, low-light, glare-shot documents")
// means a real amount often OCRs as e.g. "$1,2OO.00". This regex still
// finds and surfaces that row (never silently drops a line just because it
// misread); `parseMoneyToDollars` below is the STRICT authoritative parse
// and correctly rejects the confusable characters, producing an honest
// `amountDollars: null` ("amount unreadable") rather than a guessed digit.
const TRAILING_MONEY_RE =
  /\$?\s?[0-9OoIl]{1,3}(?:,[0-9OoIl]{3})*(?:\.[0-9OoIl]{1,2})?\s*$/;

function extractTrailingAmount(text: string): { description: string; amountRawText: string } | null {
  const trimmed = text.trim();
  const match = TRAILING_MONEY_RE.exec(trimmed);
  if (!match || match.index === 0) return null; // no trailing token, or the WHOLE line is just a number with no description
  const amountRawText = match[0].trim();
  // Guard against a false-positive match on ordinary text that happens to
  // end in an OCR-confusable letter (e.g. a line ending in "Wall" or
  // "Total" with no amount at all — "l" alone satisfies the loosened
  // TRAILING_MONEY_RE's minimum length). A real amount token always
  // contains at least one actual digit; require that here.
  if (!/\d/.test(amountRawText)) return null;
  // Real-OCR-observed failure (this task's own fixture run, documented in
  // the journal): a badly garbled line can still leave a short bare digit
  // run behind (e.g. "Roof covering replacement" OCR'd with its "$4,500.00"
  // mangled into unrelated trailing digits) with no `$`, `,`, or `.` at
  // all — that is far more likely to be OCR noise than a genuine amount in
  // this domain (contractor line items are essentially never a bare 1-3
  // digit number with none of the standard currency markers). Reject it
  // outright rather than surfacing a plausible-looking but wrong low
  // value — spec §8.1's "never a data source that commits values" applies
  // to what gets SHOWN as a candidate, not just what gets confirmed.
  if (!/[$,.]/.test(amountRawText)) return null;
  const description = trimmed.slice(0, match.index).trim().replace(/[-:.\s]+$/, "");
  if (description.length === 0) return null;
  return { description, amountRawText };
}

/**
 * Splits a page's OCR lines into candidate line items and candidate totals.
 * A line matching a total keyword is classified ONLY as a candidate total
 * (never double-counted into the line-item sum) — see
 * `reconcileLineItemsAgainstTotal` below.
 */
export function parseLineItemsAndTotals(
  lines: OcrLine[],
  pageIndex: number,
): { lineItems: CandidateLineItem[]; candidateTotals: CandidateTotal[] } {
  const lineItems: CandidateLineItem[] = [];
  const candidateTotals: CandidateTotal[] = [];

  lines.forEach((line, sourceLineIndex) => {
    const parsed = extractTrailingAmount(line.text);
    if (!parsed) return;
    const amountDollars = parseMoneyToDollars(parsed.amountRawText);
    const id = `page${pageIndex}-line${sourceLineIndex}`;

    if (TOTAL_KEYWORDS.test(parsed.description)) {
      candidateTotals.push({
        id,
        label: parsed.description,
        amountRawText: parsed.amountRawText,
        amountDollars,
        confidence: line.confidence,
        bbox: line.bbox,
        sourceLineIndex,
        pageIndex,
      });
      return;
    }

    lineItems.push({
      id,
      description: parsed.description,
      amountRawText: parsed.amountRawText,
      amountDollars,
      confidence: line.confidence,
      bbox: line.bbox,
      sourceLineIndex,
      pageIndex,
    });
  });

  return { lineItems, candidateTotals };
}

// ---------------------------------------------------------------------------
// Mitigation §8.1 — "Hallucinated digits... totals must reconcile (line
// items sum to subtotal, subtotal+tax = total) or the record flags for
// manual entry." This project's schema has no separate tax field, so the
// reconciliation this module can honestly perform is: do the CONFIRMED line
// items (the ones the human has actually verified, marked, and kept) sum to
// the human-selected total, within a cent? A mismatch does not block
// confirmation outright — spec §8.1 says it "flags for manual entry," and
// this module's confirmation UI always keeps a manual-entry path open
// (spec's closing paragraph) — but it must render prominently so the
// official cannot miss it.
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  lineItemsTotalCents: number;
  selectedTotalCents: number;
  differenceCents: number;
  reconciles: boolean;
}

const RECONCILIATION_TOLERANCE_CENTS = 1;

export function reconcileLineItemsAgainstTotal(
  lineItemDollarAmounts: number[],
  selectedTotalDollars: number,
): ReconciliationResult {
  const lineItemsTotalCents = lineItemDollarAmounts.reduce((sum, d) => sum + dollarsToCents(d), 0);
  const selectedTotalCents = dollarsToCents(selectedTotalDollars);
  const differenceCents = Math.abs(lineItemsTotalCents - selectedTotalCents);
  return {
    lineItemsTotalCents,
    selectedTotalCents,
    differenceCents,
    reconciles: differenceCents <= RECONCILIATION_TOLERANCE_CENTS,
  };
}

// ---------------------------------------------------------------------------
// Mitigation §8.6 (second half) — "sanity bounds per element and per
// structure (repair cost > 3x market value hard-flags)." This module's
// input is the structure's `improvement_value` (the closest column this
// schema has to "the value being repaired" — `assessor_market_value`
// includes land, which build spec §4.1 itself distinguishes: "assessed vs.
// market value distinction"). Task instructions for this module say
// "structure improvement value" explicitly, so `improvement_value` is used,
// not `assessor_market_value`.
// ---------------------------------------------------------------------------

const SANITY_BOUND_MULTIPLE = 3;

export interface SanityCheckResult {
  /** null when `improvementValueDollars` is null/zero — an honest "cannot
   * evaluate" state (never assume a bound was checked when the input to
   * check it against doesn't exist), matching this project's
   * never-fabricate discipline. */
  exceedsBound: boolean | null;
  thresholdDollars: number | null;
}

export function checkSanityBound(
  confirmedTotalDollars: number,
  improvementValueDollars: number | null,
): SanityCheckResult {
  if (improvementValueDollars === null || !Number.isFinite(improvementValueDollars) || improvementValueDollars <= 0) {
    return { exceedsBound: null, thresholdDollars: null };
  }
  const thresholdDollars = improvementValueDollars * SANITY_BOUND_MULTIPLE;
  return { exceedsBound: confirmedTotalDollars > thresholdDollars, thresholdDollars };
}

/** Combined document-level hash for a multi-page upload — sha256 of the
 * per-page sha256 hex strings joined with "," in page order. See
 * types.ts's "Multi-page documents" doc comment for why this exists.
 * Pure/sync here; callers (browser via Web Crypto, server via node:crypto)
 * each supply their own sha256-hex-of-bytes primitive and pass the
 * resulting hex strings in. */
export function combinedDocumentHashInput(pageHashesInOrder: string[]): string {
  return pageHashesInOrder.map((h) => h.toLowerCase()).join(",");
}
