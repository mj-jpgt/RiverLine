import styles from "./calculation.module.css";

export default function CalculationPageLoading() {
  return (
    <main className={styles.main}>
      <div className={styles.statePanel} role="status" aria-live="polite">
        <p className={styles.dt}>Loading calculation…</p>
      </div>
    </main>
  );
}
