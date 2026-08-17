"use client";

import { useState } from "react";
import { DAMAGE_PCT_PRESETS, type ElementCapture, type ElementDefinition } from "@/core/capture";
import { PhotoCapture } from "./PhotoCapture";
import { PhotoThumb } from "./PhotoThumb";
import styles from "../capture.module.css";

interface ElementScreenProps {
  element: ElementCapture;
  definition: ElementDefinition;
  index: number;
  total: number;
  onSetDamage: (pct: number) => void;
  onAddPhoto: (processed: { blob: Blob; width: number; height: number; sha256: string }) => void;
  onRemovePhoto: (photoId: string) => void;
}

// Large preset buttons only, plus a clearly separate free-entry field —
// NEVER a slider (build spec §5.3, ui-review-checklist.md Part A).
export function ElementScreen({
  element,
  definition,
  index,
  total,
  onSetDamage,
  onAddPhoto,
  onRemovePhoto,
}: ElementScreenProps) {
  const isPreset = element.damagePct !== null && (DAMAGE_PCT_PRESETS as readonly number[]).includes(element.damagePct);
  const [freeEntryOpen, setFreeEntryOpen] = useState(element.damagePct !== null && !isPreset);

  return (
    <div>
      <p className={styles.eyebrow}>
        Element {index + 1} of {total}
      </p>
      <h1 className={styles.heading}>{definition.name}</h1>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Damage percentage</span>
        <div className={styles.buttonGrid} role="group" aria-label={`Damage percentage for ${definition.name}`}>
          {DAMAGE_PCT_PRESETS.map((pct) => (
            <button
              key={pct}
              type="button"
              className={
                !freeEntryOpen && element.damagePct === pct ? styles.optionButtonSelected : styles.optionButton
              }
              onClick={() => {
                setFreeEntryOpen(false);
                onSetDamage(pct);
              }}
            >
              {pct}%
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.freeEntryToggle}
          onClick={() => setFreeEntryOpen((v) => !v)}
        >
          {freeEntryOpen ? "Use preset buttons instead" : "Enter exact percentage"}
        </button>

        {freeEntryOpen ? (
          <div className={styles.freeEntryField}>
            <label className={styles.fieldHint} htmlFor="exact-pct-input">
              Exact damage percentage (0-100)
            </label>
            <input
              id="exact-pct-input"
              className={styles.numberInput}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={!isPreset && element.damagePct !== null ? element.damagePct : ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return;
                const n = Math.max(0, Math.min(100, Number(raw)));
                onSetDamage(n);
              }}
              placeholder="e.g. 35"
            />
          </div>
        ) : null}
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Photos ({element.photoIds.length})</span>
        {element.photoIds.length > 0 ? (
          <div className={styles.photoGrid}>
            {element.photoIds.map((id) => (
              <PhotoThumb key={id} photoId={id} onRemove={() => onRemovePhoto(id)} />
            ))}
          </div>
        ) : (
          <p className={styles.fieldHint}>No photo yet for this element — optional but recommended.</p>
        )}
        <PhotoCapture label="Take photo" onCaptured={onAddPhoto} />
      </div>
    </div>
  );
}
