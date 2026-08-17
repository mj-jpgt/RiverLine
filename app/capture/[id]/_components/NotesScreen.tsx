"use client";

import styles from "../capture.module.css";

interface NotesScreenProps {
  notes: string;
  onChange: (notes: string) => void;
}

export function NotesScreen({ notes, onChange }: NotesScreenProps) {
  return (
    <div>
      <p className={styles.eyebrow}>Notes</p>
      <h1 className={styles.heading}>Assessment notes</h1>
      <p className={styles.subheading}>
        Anything an official reviewing this assessment should know — access issues, contents
        observed, anything not captured by the element screens. Optional.
      </p>

      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="notes-textarea">
          Notes
        </label>
        <textarea
          id="notes-textarea"
          className={styles.textarea}
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Optional field notes"
        />
      </div>
    </div>
  );
}
