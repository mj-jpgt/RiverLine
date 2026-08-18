import { LoadingIndicator } from "@/shared/ui";
import styles from "./page.module.css";

// Automatic Next.js route-segment loading state — calm, labeled, not a bare
// spinner (docs/design/direction.md "Smooth, not decorative").
export default function DeterminationQueueLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Official review</p>
        <h1 className={styles.heading}>Determination queue</h1>
      </div>
      <div className={styles.statePanel} role="status" aria-live="polite">
        <p className={styles.statePanelText}>Loading the review queue…</p>
        <LoadingIndicator />
      </div>
    </main>
  );
}
