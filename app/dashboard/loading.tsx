import { LoadingIndicator } from "@/shared/ui";
import styles from "./page.module.css";

// Automatic Next.js route-segment loading state — calm, labeled, not a bare
// spinner (docs/design/direction.md "Smooth, not decorative").
export default function DashboardLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Administrator dashboard</p>
        <h1 className={styles.heading}>Jurisdiction caseload</h1>
      </div>
      <div className={styles.statePanel} role="status" aria-live="polite">
        <p className={styles.statePanelText}>Loading the caseload…</p>
        <LoadingIndicator />
      </div>
    </main>
  );
}
