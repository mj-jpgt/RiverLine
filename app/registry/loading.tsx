import { LoadingIndicator } from "@/shared/ui";
import styles from "./page.module.css";

// Automatic Next.js route-segment loading state (server component data
// fetch — this covers session/DB round trips before RegistrySearch mounts
// client-side). Calm, labeled, not a bare spinner (direction.md "Smooth,
// not decorative").
export default function RegistryLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Structure registry</p>
        <h1 className={styles.heading}>Find a structure</h1>
      </div>
      <div className={styles.statePanel} role="status" aria-live="polite">
        <p className={styles.statePanelText}>Loading…</p>
        <LoadingIndicator />
      </div>
    </main>
  );
}
