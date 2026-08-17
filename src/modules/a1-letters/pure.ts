// Pure, zero-I/O helpers for the A1 letters module: formatting raw DB facts
// into LetterFacts, and rendering the print-first HTML letter document.
// Kept separate from queries.ts/actions.ts (which do all the DB/filesystem
// work) — same split src/core/determination/pure.ts already established.
//
// docs/adr/0006-letter-rendering.md: print-CSS HTML + browser
// print-to-PDF, zero new dependencies. This file's renderLetterHtml output
// IS THE ARTIFACT — a self-contained HTML document with its own embedded
// styles (never depends on the app's global stylesheet or tokens.css at
// runtime), because it must remain byte-identical whether opened in the app
// shell, saved to disk as the archived record, or reopened months later for
// an appeal.
//
// docs/design/direction.md -> "Print": "black on white, no background
// fills, no color-dependent information." This is the one place in the
// codebase where literal `black`/`white` keywords are correct rather than
// tokens.css tokens — the letter is a piece of paper mailed to a homeowner,
// not an app screen read in sunlight; tokens.css's screen-legibility
// tokens (avoiding pure black/white for on-device contrast reasons) do not
// apply to ink on paper. Named CSS colors are used, never raw hex, so this
// file still passes the repo's no-raw-color lint rule.

import type { LetterFacts, ThresholdResultForLetter } from "./types";

export const TEMPLATE_VERSION = "a1-letter-v1";

/** specs/build-spec.md §7.8, verbatim intent: "every calculation screen and
 * letter footer states the tool is a calculation and documentation aid and
 * the determination is made by the local official under their ordinance
 * authority." This is house policy copy authored from that spec line, not
 * an external legal fact requiring a primary-source citation (AGENTS.md
 * rule 4 governs field names/costs/citations/statutes — not this app's own
 * disclosure language). Always present, both SD and NOT_SD variants. */
export const MANDATORY_FOOTER_TEXT =
  "This letter was prepared with the assistance of RiverLine, a calculation and documentation aid. " +
  "It is not an automated or algorithmic determination: the substantial damage / substantial " +
  "improvement finding stated above was made by the jurisdiction's floodplain administrator, acting " +
  "under the authority of the jurisdiction's floodplain ordinance.";

export function isNonEmptyOrdinanceCitation(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidAppealWindowDays(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatRatioPct(ratio: number): string {
  return (ratio * 100).toFixed(1);
}

function toDateOnly(value: string): string {
  // Accepts either an ISO timestamp or an ISO date; always returns the
  // date-only portion, never a fabricated "today" when a real value exists.
  return value.length >= 10 ? value.slice(0, 10) : value;
}

export interface RawLetterInputs {
  jurisdictionName: string;
  letterheadAddressLines: string[] | null;
  structureAddress: string;
  parcelId: string;
  assessmentCompletedAtIso: string;
  ratio: number;
  thresholdResult: ThresholdResultForLetter;
  ordinanceCitation: string;
  appealDeadlineDateIso: string | null;
  officialEmail: string;
  adoptedAtIso: string;
  iccText: string | null;
}

/** Assembles the display-ready LetterFacts from raw DB rows. Pure
 * formatting only — no fabrication: every optional field stays null/empty
 * unless the raw input actually carries a value. */
export function buildLetterFacts(input: RawLetterInputs): LetterFacts {
  return {
    jurisdictionName: input.jurisdictionName,
    letterheadAddressLines: input.letterheadAddressLines ?? [],
    structureAddress: input.structureAddress,
    parcelId: input.parcelId,
    assessmentDateIso: toDateOnly(input.assessmentCompletedAtIso),
    ratioPct: formatRatioPct(input.ratio),
    thresholdResult: input.thresholdResult,
    ordinanceCitation: input.ordinanceCitation,
    appealDeadlineDateIso: input.appealDeadlineDateIso,
    officialEmail: input.officialEmail,
    adoptedDateIso: toDateOnly(input.adoptedAtIso),
    iccText: input.iccText,
    templateVersion: TEMPLATE_VERSION,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * Renders the full, standalone, print-first HTML letter document.
 * `issued` controls only the screen-only preview banner (never printed,
 * never part of the archived record's legal content) — everything else is
 * identical between a live preview and the archived issued copy, because
 * the underlying facts (an adopted determination's calculation and the
 * jurisdiction's on-file citation) do not change after adoption.
 */
export function renderLetterHtml(facts: LetterFacts, opts: { issued: boolean }): string {
  const {
    jurisdictionName,
    letterheadAddressLines,
    structureAddress,
    parcelId,
    assessmentDateIso,
    ratioPct,
    thresholdResult,
    ordinanceCitation,
    appealDeadlineDateIso,
    officialEmail,
    adoptedDateIso,
    iccText,
    templateVersion,
  } = facts;

  const findingSentence =
    thresholdResult === "SD"
      ? `this office has determined that the structure IS substantially damaged, because the ratio of ${escapeHtml(
          ratioPct,
        )}% meets or exceeds the 50% substantial-damage threshold.`
      : `this office has determined that the structure IS NOT substantially damaged, because the ratio of ${escapeHtml(
          ratioPct,
        )}% is below the 50% substantial-damage threshold.`;

  const appealParagraph = appealDeadlineDateIso
    ? `<p>You may appeal this determination under the procedure set out in the jurisdiction's floodplain ordinance. The appeal deadline is <strong>${escapeHtml(
        formatDateLong(appealDeadlineDateIso),
      )}</strong>.</p>`
    : "";

  const iccParagraph = iccText
    ? `<p><strong>Increased Cost of Compliance (ICC):</strong> ${escapeHtml(iccText)}</p>`
    : "";

  const letterheadAddressHtml = letterheadAddressLines.length
    ? `<p class="letterheadAddress">${letterheadAddressLines.map(escapeHtml).join("<br />")}</p>`
    : "";

  const previewBanner = opts.issued
    ? ""
    : `<div class="previewBanner" role="status">PREVIEW — this letter has not been issued yet</div>`;

  const printButton = `<div class="screenOnlyBar"><button type="button" class="printButton" onclick="window.print()">Print / Save as PDF</button></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Determination letter — ${escapeHtml(structureAddress)}</title>
<style>
  :root { color-scheme: only light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: white;
    color: black;
    font-family: Georgia, "Times New Roman", serif;
  }
  .page {
    max-width: 44rem;
    margin: 0 auto;
    padding: 48px 56px 64px;
    line-height: 1.55;
    font-size: 15px;
  }
  .previewBanner {
    background: white;
    color: black;
    border: 2px solid black;
    font-family: system-ui, sans-serif;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-align: center;
    padding: 10px 16px;
    margin: 0 0 24px;
  }
  .screenOnlyBar {
    display: flex;
    justify-content: flex-end;
    max-width: 44rem;
    margin: 16px auto 0;
    padding: 0 56px;
  }
  .printButton {
    font-family: system-ui, sans-serif;
    font-weight: 700;
    font-size: 15px;
    padding: 10px 20px;
    min-height: 44px;
    background: white;
    color: black;
    border: 2px solid black;
    cursor: pointer;
  }
  .printButton:hover { background: black; color: white; }
  .letterhead { margin-bottom: 32px; border-bottom: 1px solid black; padding-bottom: 16px; }
  .letterheadName { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .letterheadAddress { margin: 0; font-size: 13px; }
  .meta { margin: 0 0 24px; }
  .meta p { margin: 0 0 4px; }
  .ratio { font-variant-numeric: tabular-nums; font-weight: 700; }
  .citation {
    margin: 16px 0;
    padding: 12px 16px;
    border-left: 3px solid black;
    font-style: italic;
    white-space: pre-wrap;
  }
  .signature { margin-top: 40px; }
  .footer {
    margin-top: 56px;
    padding-top: 16px;
    border-top: 1px solid black;
    font-size: 11px;
    font-family: system-ui, sans-serif;
    color: black;
  }
  .templateVersion { font-size: 10px; color: black; margin-top: 8px; }
  @media print {
    .previewBanner, .screenOnlyBar { display: none; }
    .page { padding: 0; max-width: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>
${previewBanner}
${printButton}
<div class="page">
  <header class="letterhead">
    <p class="letterheadName">${escapeHtml(jurisdictionName)}</p>
    ${letterheadAddressHtml}
  </header>

  <div class="meta">
    <p>${escapeHtml(formatDateLong(adoptedDateIso))}</p>
    <p>Re: ${escapeHtml(structureAddress)} (Parcel ${escapeHtml(parcelId)})</p>
  </div>

  <p>Substantial damage / substantial improvement determination</p>

  <p>
    Based on an assessment of the structure at ${escapeHtml(structureAddress)} completed on
    ${escapeHtml(formatDateLong(assessmentDateIso))}, the estimated cost of repair was compared to the
    market value of the structure, producing a ratio of <span class="ratio">${escapeHtml(
      ratioPct,
    )}%</span>. Under the substantial damage / substantial improvement threshold of 50% of market value,
    ${findingSentence}
  </p>

  <p>This determination is made under the authority of:</p>
  <p class="citation">${escapeHtml(ordinanceCitation)}</p>

  ${appealParagraph}
  ${iccParagraph}

  <div class="signature">
    <p>Adopting official: ${escapeHtml(officialEmail)}</p>
    <p>Date adopted: ${escapeHtml(formatDateLong(adoptedDateIso))}</p>
  </div>

  <div class="footer">
    <p>${MANDATORY_FOOTER_TEXT}</p>
    <p class="templateVersion">Template version: ${escapeHtml(templateVersion)}</p>
  </div>
</div>
</body>
</html>`;
}
