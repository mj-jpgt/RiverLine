import styles from "./motion.module.css";

// Calm, steady "in progress" indicator — see src/shared/ui/motion.module.css
// and docs/design/motion.md #4. Purely visual; the caller keeps its own
// existing labeled text (e.g. styles.statePanelText) and role="status"
// aria-live="polite" wrapper — this never stands in as the only signal
// (direction.md "Smooth, not decorative" #3; ui-review-checklist.md Part B
// "no jarring/alarming spinner implying an error when none exists").
// aria-hidden: the label text next to it is what assistive tech announces.
export function LoadingIndicator() {
  return (
    <div className={styles.loadingTrack} aria-hidden="true">
      <div className={styles.loadingFill} />
    </div>
  );
}
