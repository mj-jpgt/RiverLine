import Link from "next/link";
import styles from "./page.module.css";

export default function LetterNotFound() {
  return (
    <main className={styles.main}>
      <Link href="/determination" className={styles.backLink}>
        ← Back to queue
      </Link>
      <div className={styles.header}>
        <h1 className={styles.heading}>Assessment not found</h1>
      </div>
      <div className={styles.blockedPanel} role="status">
        <p className={styles.blockedText}>
          No assessment matches this link. It may have been synced under a different client id, or the link may be
          stale.
        </p>
      </div>
    </main>
  );
}
