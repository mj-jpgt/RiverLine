"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";

export default function CapturePageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[capture] page error:", error);
  }, [error]);

  return (
    <main className={styles.main}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.errorPanel} role="alert">
        <p className={styles.statePanelText}>
          This assessment could not load right now. Anything already saved on this device is
          still safe in local storage — check your connection and try again.
        </p>
        <button type="button" onClick={() => reset()} className={styles.retryButton}>
          Try again
        </button>
      </div>
    </main>
  );
}
