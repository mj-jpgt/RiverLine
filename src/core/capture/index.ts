// Public entry point for src/core/capture — the only path app/ (or any
// other core family) may import through, per eslint-plugin-boundaries
// (docs/adr/0003-module-boundary-enforcement.md).

export { RESIDENTIAL_ELEMENTS, NON_RESIDENTIAL_ELEMENTS, elementsForOccupancy } from "./elements";
export type { ElementDefinition, Occupancy } from "./elements";

export {
  WATER_DEPTH_SOURCES,
  DAMAGE_PCT_PRESETS,
  FOUNDATION_TYPES,
  isDraftComplete,
  newPhotoUploadState,
} from "./types";
export type {
  WaterDepthSource,
  FoundationType,
  GpsFix,
  PhotoRecord,
  PhotoUploadStatus,
  ElementCapture,
  SyncStatus,
  CaptureDraft,
} from "./types";

export {
  newClientId,
  createDraft,
  setOccupancy,
  setAttributes,
  setGps,
  setElementDamage,
  addPhotoToElement,
  removePhotoFromElement,
  addExteriorPhoto,
  removeExteriorPhoto,
  setWaterDepth,
  setNotes,
  goToStep,
  completeDraft,
  totalSteps,
  screenForStep,
  canAdvanceFromStep,
} from "./draft";
export type { StructurePrefill, ScreenKind } from "./draft";

export {
  saveDraft,
  getDraft,
  getResumableDraftForStructure,
  getAllDrafts,
  getQueuedDrafts,
  savePhoto,
  getPhoto,
  getPhotosForDraft,
  markPhotoUploadAttempt,
  markPhotoUploaded,
} from "./db";

export { processPhoto, sha256Hex, MAX_LONGEST_EDGE_PX } from "./photo";
export type { ProcessedPhoto } from "./photo";

export { syncOne, syncAllQueued, registerSyncTriggers } from "./sync";
export type { SyncResult, PhotoUploadProgress } from "./sync";

export { uploadPhoto, uploadPendingPhotosForDraft } from "./photo-upload";
export type { PhotoUploadResult, UploadPendingPhotosResult } from "./photo-upload";

export { buildSyncPayload } from "./payload";
export type { SyncPayload, SyncPhotoPayload } from "./payload";

export { MAX_SYNC_ATTEMPTS, backoffDelayMs, nextAttempt } from "./backoff";
export type { AttemptOutcome } from "./backoff";
