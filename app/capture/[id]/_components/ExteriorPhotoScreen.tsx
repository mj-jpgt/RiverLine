"use client";

import { PhotoCapture } from "./PhotoCapture";
import { PhotoThumb } from "./PhotoThumb";
import styles from "../capture.module.css";

interface ExteriorPhotoScreenProps {
  photoIds: string[];
  onAddPhoto: (processed: { blob: Blob; width: number; height: number; sha256: string }) => void;
  onRemovePhoto: (photoId: string) => void;
}

// The one always-required photo step (build spec §6.1) — distinct from the
// optional per-element photos.
export function ExteriorPhotoScreen({ photoIds, onAddPhoto, onRemovePhoto }: ExteriorPhotoScreenProps) {
  return (
    <div>
      <p className={styles.eyebrow}>Required</p>
      <h1 className={styles.heading}>Exterior photo</h1>
      <p className={styles.subheading}>
        Capture at least one photo of the structure&apos;s exterior. This is required to complete
        the assessment.
      </p>

      {photoIds.length > 0 ? (
        <div className={styles.photoGrid}>
          {photoIds.map((id) => (
            <PhotoThumb key={id} photoId={id} onRemove={() => onRemovePhoto(id)} />
          ))}
        </div>
      ) : (
        <p className={styles.fieldHint}>No exterior photo yet.</p>
      )}

      <PhotoCapture label="Take exterior photo" onCaptured={onAddPhoto} />

      {photoIds.length === 0 ? (
        <p className={styles.errorText} role="alert">
          At least one exterior photo is required to continue.
        </p>
      ) : null}
    </div>
  );
}
