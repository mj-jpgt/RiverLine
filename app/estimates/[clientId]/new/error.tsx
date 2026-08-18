"use client";

import { useEffect } from "react";
import styles from "../../page.module.css";

export default function NewEstimateError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[estimates] new page error:", error);
  }, [error]);

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Something went wrong</h1>
      </div>
      <div className={styles.errorPanel} role="alert">
        <p className={styles.statePanelText}>This page could not load right now. Check your connection and try again.</p>
      </div>
      <button type="button" onClick={() => reset()} className={styles.newEstimateLink}>
        Try again
      </button>
    </main>
  );
}
