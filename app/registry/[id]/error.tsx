"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./page.module.css";

export default function StructureDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[registry] detail page error:", error);
  }, [error]);

  return (
    <main className={styles.main}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.errorPanel} role="alert">
        <p className={styles.statePanelText}>
          This structure could not load right now. Check your connection and
          try again.
        </p>
        <button type="button" onClick={() => reset()} className={styles.retryButton}>
          Try again
        </button>
      </div>
    </main>
  );
}
