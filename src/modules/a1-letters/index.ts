// Public entry point for src/modules/a1-letters — the only path app/ (or
// any other module/core family) may import through, per
// eslint-plugin-boundaries (docs/adr/0003-module-boundary-enforcement.md).
export { getLetterPreview, readArchivedLetterHtml } from "./queries";
export { issueLetter, setOrdinanceCitation } from "./actions";
export {
  buildLetterFacts,
  renderLetterHtml,
  isNonEmptyOrdinanceCitation,
  isValidAppealWindowDays,
  TEMPLATE_VERSION,
  MANDATORY_FOOTER_TEXT,
} from "./pure";
export type {
  LetterFacts,
  LetterPreviewResult,
  ThresholdResultForLetter,
  IssueLetterResult,
  SetOrdinanceResult,
} from "./types";
export type { RawLetterInputs } from "./pure";
export type { SetOrdinanceInput } from "./actions";
