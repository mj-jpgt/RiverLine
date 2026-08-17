import Link from "next/link";
import styles from "./calculation.module.css";

// Designed empty state for an unknown/removed assessment client_id, rather
// than Next's default 404 (direction.md "Smooth, not decorative" #6).
export default function CalculationNotFound() {
  return (
    <main className={styles.main}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.statePanel}>
        <h1 className={styles.blockedHeading}>Assessment not found</h1>
        <p className={styles.dt}>
          No synced assessment matches that record — it may not have finished syncing yet, or the
          link may be out of date. Check the assessment&apos;s sync status and try again.
        </p>
      </div>
    </main>
  );
}
