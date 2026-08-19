"use client";

import styles from "./page.module.css";

/** Tiny client component so app/how-it-works/paper-form/page.tsx can stay a
 * plain server component (it imports RESIDENTIAL_ELEMENTS/NON_RESIDENTIAL_ELEMENTS/
 * DAMAGE_PCT_PRESETS straight from src/core/capture, no client-only state
 * needed anywhere else on the page) while still offering a one-tap print
 * trigger, same "screen-only control, invisible on paper" pattern
 * src/modules/a1-letters/pure.ts's renderLetterHtml already uses for the
 * determination letter's own print button. */
export function PrintButton() {
  return (
    <button type="button" className={styles.printButton} onClick={() => window.print()}>
      Print this worksheet
    </button>
  );
}
