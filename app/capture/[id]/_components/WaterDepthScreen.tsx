"use client";

import { WATER_DEPTH_SOURCES, type WaterDepthSource } from "@/core/capture";
import styles from "../capture.module.css";

interface WaterDepthScreenProps {
  depthIn: number | null;
  source: WaterDepthSource | null;
  onChange: (depthIn: number | null, source: WaterDepthSource | null) => void;
}

export function WaterDepthScreen({ depthIn, source, onChange }: WaterDepthScreenProps) {
  return (
    <div>
      <p className={styles.eyebrow}>Water depth</p>
      <h1 className={styles.heading}>Interior water depth</h1>
      <p className={styles.subheading}>
        Record the interior flood depth if known. If it wasn&apos;t observed or measured, mark the
        source as unknown rather than leaving this blank.
      </p>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="water-depth-input">
          Depth (inches)
        </label>
        <input
          id="water-depth-input"
          className={styles.numberInput}
          type="number"
          inputMode="decimal"
          min={0}
          value={depthIn ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw), source);
          }}
          placeholder="e.g. 18"
        />
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Source</span>
        <div className={styles.buttonGridWide} role="group" aria-label="Water depth source">
          {WATER_DEPTH_SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={source === s.value ? styles.optionButtonSelected : styles.optionButton}
              onClick={() => onChange(depthIn, s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
