import Link from "next/link";
import styles from "./page.module.css";

// Designed empty state for an unknown/removed structure id, rather than
// Next's default 404 (direction.md "Smooth, not decorative" #6).
export default function CaptureNotFound() {
  return (
    <main className={styles.main}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.card}>
        <h1 className={styles.heading}>Structure not found</h1>
        <p className={styles.dt}>
          No structure matches that record — it may have been removed, or the link may be out of
          date. Search again from the registry before starting an assessment.
        </p>
      </div>
    </main>
  );
}
