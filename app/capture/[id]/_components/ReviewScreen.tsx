"use client";

import type { CaptureDraft, ElementDefinition } from "@/core/capture";
import styles from "../capture.module.css";

interface ReviewScreenProps {
  draft: CaptureDraft;
  elementDefs: readonly ElementDefinition[];
  onComplete: () => void;
  completing: boolean;
  canComplete: boolean;
}

export function ReviewScreen({ draft, elementDefs, onComplete, completing, canComplete }: ReviewScreenProps) {
  const byCode = new Map(draft.elements.map((e) => [e.code, e]));

  return (
    <div>
      <p className={styles.eyebrow}>Review</p>
      <h1 className={styles.heading}>Review and complete</h1>
      <p className={styles.subheading}>
        Check every element before completing. You can go back and change anything.
      </p>

      <ul className={styles.reviewList}>
        {elementDefs.map((def) => {
          const el = byCode.get(def.code);
          const missing = !el || el.damagePct === null;
          return (
            <li key={def.code} className={styles.reviewRow}>
              <span className={styles.reviewRowLabel}>{def.name}</span>
              <span className={missing ? styles.reviewRowFlag : styles.reviewRowValue}>
                {missing ? "Not set" : `${el.damagePct}% · ${el.photoIds.length} photo${el.photoIds.length === 1 ? "" : "s"}`}
              </span>
            </li>
          );
        })}
        <li className={styles.reviewRow}>
          <span className={styles.reviewRowLabel}>Exterior photo</span>
          <span className={draft.exteriorPhotoIds.length === 0 ? styles.reviewRowFlag : styles.reviewRowValue}>
            {draft.exteriorPhotoIds.length === 0 ? "Required" : `${draft.exteriorPhotoIds.length} captured`}
          </span>
        </li>
        <li className={styles.reviewRow}>
          <span className={styles.reviewRowLabel}>Water depth</span>
          <span className={styles.reviewRowValue}>
            {draft.waterDepthInteriorIn !== null
              ? `${draft.waterDepthInteriorIn} in (${draft.waterDepthSource})`
              : draft.waterDepthSource === "unknown"
                ? "Unknown"
                : "Not recorded"}
          </span>
        </li>
        <li className={styles.reviewRow}>
          <span className={styles.reviewRowLabel}>GPS</span>
          <span className={styles.reviewRowValue}>
            {draft.gps
              ? `${draft.gps.lat.toFixed(5)}, ${draft.gps.lng.toFixed(5)} (±${Math.round(draft.gps.accuracyM)}m)`
              : "Not available"}
          </span>
        </li>
        <li className={styles.reviewRow}>
          <span className={styles.reviewRowLabel}>Notes</span>
          <span className={styles.reviewRowValue}>{draft.notes.trim().length > 0 ? "Added" : "None"}</span>
        </li>
      </ul>

      {!canComplete ? (
        <p className={styles.errorText} role="alert">
          Every element needs a damage percentage and the exterior photo is required before this
          assessment can be completed.
        </p>
      ) : null}

      <button type="button" className={styles.completeButton} disabled={!canComplete || completing} onClick={onComplete}>
        {completing ? "Saving…" : "Complete assessment"}
      </button>
    </div>
  );
}
