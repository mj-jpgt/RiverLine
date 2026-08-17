"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

// Route-segment error boundary (server component failures — e.g. DB
// unreachable during the session check). Designed error state, not a
// default Next.js error screen.
export default function RegistryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[registry] page error:", error);
  }, [error]);

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Structure registry</p>
        <h1 className={styles.heading}>Something went wrong</h1>
      </div>
      <div className={styles.errorPanel} role="alert">
        <p className={styles.statePanelText}>
          The registry could not load right now. Check your connection and try
          again.
        </p>
      </div>
      <button type="button" onClick={() => reset()} className={styles.locateButton}>
        Try again
      </button>
    </main>
  );
}
