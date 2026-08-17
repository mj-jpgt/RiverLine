import Link from "next/link";
import styles from "./page.module.css";

// Designed empty state for an unknown/removed structure id, rather than
// Next's default 404 page (direction.md "Smooth, not decorative" — no
// blank/default states).
export default function StructureNotFound() {
  return (
    <main className={styles.main}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.card}>
        <h1 className={styles.cardHeading}>Structure not found</h1>
        <p className={styles.dt}>
          No structure matches that record. It may have been removed, or the
          link may be out of date — search again from the registry.
        </p>
      </div>
    </main>
  );
}
