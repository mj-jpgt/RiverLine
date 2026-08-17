"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./calculation.module.css";

export default function CalculationPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[calculation] page error:", error);
  }, [error]);

  return (
    <main className={styles.main}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.errorPanel} role="alert">
        <p className={styles.statePanelText}>
          The calculation could not load right now. No calculation was silently produced or lost —
          check your connection and try again.
        </p>
        <button type="button" onClick={() => reset()} className={styles.retryButton}>
          Try again
        </button>
      </div>
    </main>
  );
}
