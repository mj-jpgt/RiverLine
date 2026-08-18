// Public entry point for src/modules/a4-estimates — the only path app/ (or
// any other module/core family) may import through, per
// eslint-plugin-boundaries (docs/adr/0003-module-boundary-enforcement.md).
export {
  getAssessmentEstimatesContext,
  getEstimateDetail,
  resolveEstimatePageStorageKey,
  searchAssessmentsForEstimates,
} from "./queries";
export { createEstimateVersion, confirmEstimate } from "./actions";
export {
  parseMoneyToDollars,
  dollarsToCents,
  centsToDollars,
  parseLineItemsAndTotals,
  reconcileLineItemsAgainstTotal,
  checkSanityBound,
  combinedDocumentHashInput,
} from "./parser";
export type { ReconciliationResult, SanityCheckResult } from "./parser";
export { runOcrOnPages } from "./ocr.client";
export type { OcrProgress } from "./ocr.client";
export { processEstimatePage, sha256Hex } from "./image.client";
export type {
  Uuid,
  IsoTimestamp,
  OcrBoundingBox,
  OcrLine,
  CandidateLineItem,
  CandidateTotal,
  ExtractedPage,
  ExtractedJson,
  EstimatePageUpload,
  EstimatePageStorage,
  EstimateProvenance,
  ConfirmedLineItem,
  EstimateVersionSummary,
  EstimateDetail,
  AssessmentEstimatesContext,
  CreateEstimateInput,
  CreateEstimateResult,
  ConfirmEstimateInput,
  ConfirmEstimateResult,
} from "./types";
export type { AssessmentListRow } from "./queries";
