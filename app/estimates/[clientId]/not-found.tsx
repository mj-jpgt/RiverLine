import Link from "next/link";
import styles from "../page.module.css";

export default function AssessmentEstimatesNotFound() {
  return (
    <main className={styles.main}>
      <Link href="/estimates" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.header}>
        <h1 className={styles.heading}>Assessment not found</h1>
      </div>
      <div className={styles.statePanel} role="status">
        <p className={styles.statePanelText}>
          No completed assessment matches this link. It may have been synced under a different client id, or the
          link may be stale.
        </p>
      </div>
    </main>
  );
}
