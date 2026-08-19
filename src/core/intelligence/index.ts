// Public entry point for src/core/intelligence — the only path app/ (or any
// other core family) may import through, per eslint-plugin-boundaries
// (docs/adr/0003-module-boundary-enforcement.md).
export { getTriageQueue, getGpsDistanceMeters, getExposureRollup } from "./queries";
export {
  closenessScore,
  minMaxScore,
  zoneSeverityTier,
  zoneSeverityScore,
  computeTriageScore,
  spread,
  sortTriageQueue,
  computeReviewFlags,
} from "./pure";
export type { TriageRawInput } from "./pure";
export type {
  TriageScoreBreakdown,
  TriageQueueRow,
  ReviewFlag,
  ReviewFlagCode,
  ReviewFlagElementInput,
  ReviewFlagPhotoInput,
  ReviewFlagInput,
  ExposureRollup,
} from "./types";
