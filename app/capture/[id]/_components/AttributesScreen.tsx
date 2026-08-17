"use client";

import { FOUNDATION_TYPES, type CaptureDraft, type FoundationType, type Occupancy } from "@/core/capture";
import styles from "../capture.module.css";

interface AttributesScreenProps {
  draft: CaptureDraft;
  address: string;
  onSetOccupancy: (occupancy: Occupancy) => void;
  onSetAttributes: (attrs: {
    sqFt?: number | null;
    stories?: number | null;
    foundationType?: FoundationType | null;
  }) => void;
}

const STORY_OPTIONS = [1, 2, 3, 4] as const;

export function AttributesScreen({ draft, address, onSetOccupancy, onSetAttributes }: AttributesScreenProps) {
  return (
    <div>
      <p className={styles.eyebrow}>Confirm structure</p>
      <h1 className={styles.heading}>{address}</h1>
      <p className={styles.subheading}>
        Confirm what&apos;s on file before starting the element-by-element walkthrough. Nothing
        here is final — everything can be corrected later by an official.
      </p>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Occupancy type</span>
        <div className={styles.buttonGridWide} role="group" aria-label="Occupancy type">
          <button
            type="button"
            className={draft.occupancyType === "residential" ? styles.optionButtonSelected : styles.optionButton}
            onClick={() => onSetOccupancy("residential")}
          >
            Residential
          </button>
          <button
            type="button"
            className={
              draft.occupancyType === "non_residential" ? styles.optionButtonSelected : styles.optionButton
            }
            onClick={() => onSetOccupancy("non_residential")}
          >
            Non-residential
          </button>
        </div>
        {draft.occupancyType === null ? (
          <p className={styles.errorText} role="alert">
            Not on file — choose one to continue.
          </p>
        ) : null}
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="sqft-input">
          Square footage
        </label>
        <input
          id="sqft-input"
          className={styles.numberInput}
          type="number"
          inputMode="numeric"
          min={0}
          value={draft.sqFt ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            onSetAttributes({ sqFt: raw === "" ? null : Number(raw) });
          }}
          placeholder="Enter square footage"
        />
        <p className={styles.fieldHint}>Prefilled from the parcel record where available — editable.</p>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Stories</span>
        <div className={styles.buttonGrid} role="group" aria-label="Stories">
          {STORY_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={draft.stories === n ? styles.optionButtonSelected : styles.optionButton}
              onClick={() => onSetAttributes({ stories: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Foundation type</span>
        <div className={styles.buttonGridWide} role="group" aria-label="Foundation type">
          {FOUNDATION_TYPES.map((f) => (
            <button
              key={f.value}
              type="button"
              className={draft.foundationType === f.value ? styles.optionButtonSelected : styles.optionButton}
              onClick={() => onSetAttributes({ foundationType: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
