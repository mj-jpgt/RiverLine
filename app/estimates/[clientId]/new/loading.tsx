import styles from "../../page.module.css";

export default function NewEstimateLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Contractor estimates</p>
        <h1 className={styles.heading}>Loading…</h1>
      </div>
      <div className={styles.statePanel} role="status" aria-live="polite">
        <p className={styles.statePanelText}>Loading…</p>
      </div>
    </main>
  );
}
