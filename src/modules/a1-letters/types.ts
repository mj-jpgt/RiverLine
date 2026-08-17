// Public types for the A1 determination-letter module.
//
// Mirrors schema/core.sql's `letters` / `determinations` / `jurisdictions`
// shapes (frozen — never edited). specs/constitution.md #2 is the core
// constraint this whole module exists to satisfy: jurisdictions.ordinance_citation
// is null in every real environment today (docs/BLOCKERS.md B2, verified
// blocked — Cloudflare bot protection defeats automated retrieval of the
// Noblesville ordinance text). Letter generation must refuse explicitly,
// never fabricate a citation.

export type ThresholdResultForLetter = "SD" | "NOT_SD";

/**
 * Every fact a rendered letter needs, already formatted for display. Built
 * by `buildLetterFacts` (pure.ts) from raw DB rows — never assembled ad hoc
 * in a component, so the unit tests can cover the formatting rules once.
 */
export interface LetterFacts {
  jurisdictionName: string;
  /** letterhead_config address lines, verbatim, jurisdiction-supplied.
   * Empty array (never fabricated) when not configured — the letterhead
   * block then shows only the jurisdiction name. */
  letterheadAddressLines: string[];
  structureAddress: string;
  parcelId: string;
  /** Date-only (YYYY-MM-DD). The assessment's `completed_at`, i.e. the date
   * the field inspection was finished — the closest real fact this schema
   * offers to "date of assessment." */
  assessmentDateIso: string;
  /** Formatted to one decimal place, e.g. "63.4" — never a raw fraction. */
  ratioPct: string;
  thresholdResult: ThresholdResultForLetter;
  /** Verbatim, human-entered text from jurisdictions.ordinance_citation.
   * Never generated, never a default, never paraphrased. */
  ordinanceCitation: string;
  /** null when determinations.appeal_deadline_date is not set (no
   * appeal_window_days configured for the jurisdiction) — the appeal
   * sentence is omitted entirely in that case, never a guessed date. */
  appealDeadlineDateIso: string | null;
  /** schema/core.sql's `users` table has no name column — only email.
   * Labeled honestly as the adopting official's account identifier rather
   * than inventing a display name. */
  officialEmail: string;
  adoptedDateIso: string;
  /** Only present when a jurisdiction has supplied its own ICC paragraph
   * text in letterhead_config.icc_text. Rendered verbatim if present, and
   * ENTIRELY OMITTED otherwise — this module never authors ICC prose
   * (task constraint; ICC eligibility rules are jurisdiction/FEMA-specific
   * legal content this codebase has no verified source for). */
  iccText: string | null;
  templateVersion: string;
}

export type LetterPreviewResult =
  | { status: "not_found" }
  /** No determination on record for this assessment, or the most recent
   * one is not currently `adopted` (draft / superseded / contested).
   * AGENTS.md rule 12 — never a letter for anything but an adopted
   * determination. */
  | { status: "no_determination" }
  /** threshold_result is BORDERLINE. A letter must state a definite SD /
   * NOT_SD finding (task requirement — "SD and NOT_SD variants" only); a
   * borderline ratio has no such finding until the official resolves it
   * (override, or accepts the calculated split). Deliberate module
   * decision, documented in the journal — not silently rendering a
   * misleading definite statement for an undecided case. */
  | { status: "borderline_unresolved" }
  /** THE headline refusal state (specs/constitution.md #2, docs/BLOCKERS.md B2). */
  | { status: "citation_missing"; jurisdictionId: string; jurisdictionName: string }
  | {
      status: "ready";
      determinationId: string;
      jurisdictionId: string;
      facts: LetterFacts;
    }
  | {
      status: "issued";
      determinationId: string;
      jurisdictionId: string;
      letterId: string;
      issuedAt: string;
      storageKey: string;
      facts: LetterFacts;
    };

export interface IssueLetterResult {
  ok: boolean;
  error?: "not_ready" | "not_found" | "already_issued";
  letterId?: string;
  storageKey?: string;
}

export interface SetOrdinanceResult {
  ok: boolean;
  error?: "citation_required" | "invalid_appeal_window" | "not_found";
}
