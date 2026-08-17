"use client";

import { useEffect } from "react";
import styles from "./review.module.css";

export default function DeterminationReviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[determination] review page error:", error);
  }, [error]);

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Something went wrong</h1>
      </div>
      <div className={styles.blockedPanel} role="alert">
        <p className={styles.blockedText}>
          This review could not load right now. Check your connection and try again.
        </p>
      </div>
      <button type="button" onClick={() => reset()} className={styles.overrideCancelButton}>
        Try again
      </button>
    </main>
  );
}
