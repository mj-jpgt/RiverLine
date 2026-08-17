import styles from "./review.module.css";

export default function DeterminationReviewLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Official review</p>
        <h1 className={styles.heading}>Loading…</h1>
      </div>
      <div className={styles.blockedPanel} role="status" aria-live="polite">
        <p className={styles.blockedText}>Loading the review…</p>
      </div>
    </main>
  );
}
