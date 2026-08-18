import { LoadingIndicator } from "@/shared/ui";
import styles from "./page.module.css";

export default function LetterLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Determination letter</p>
        <h1 className={styles.heading}>Loading…</h1>
      </div>
      <div className={styles.blockedPanel} role="status" aria-live="polite">
        <p className={styles.blockedText}>Loading the letter…</p>
        <LoadingIndicator />
      </div>
    </main>
  );
}
