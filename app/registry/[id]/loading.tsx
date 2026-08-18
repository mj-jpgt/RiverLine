import { LoadingIndicator } from "@/shared/ui";
import styles from "./page.module.css";

export default function StructureDetailLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.card} role="status" aria-live="polite">
        <p className={styles.dt}>Loading structure…</p>
        <LoadingIndicator />
      </div>
    </main>
  );
}
