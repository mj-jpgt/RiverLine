// Public entry point for src/modules/a3-sde-export (T-A3).
export { EXPORT_SCHEMA_VERSION } from "./types";
export type {
  AssessmentExportJson,
  DeterminationStatus,
  ExportAssessmentData,
  ExportDetermination,
  ExportElement,
  Occupancy,
  ThresholdResult,
} from "./types";

export { csvEscapeField, toCsvRow, buildCsv } from "./csv";

export {
  buildAssessmentExportJson,
  buildElementCsv,
  buildElementCsvRows,
  buildBatchElementCsv,
  buildSummaryCsv,
  buildSummaryCsvRow,
  buildBatchSummaryCsv,
  ELEMENT_CSV_HEADER,
  SUMMARY_CSV_HEADER,
} from "./build-export";

export { getExportAssessmentData, getBatchExportData } from "./queries";
export type { ExportLookupResult } from "./queries";
