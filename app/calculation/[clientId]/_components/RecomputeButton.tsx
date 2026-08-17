"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../calculation.module.css";

/**
 * The explicit on-demand re-run control (task requirement 2: "on-demand
 * from the review screen"). Always inserts a NEW calculations row
 * (AGENTS.md rule 10 — never UPDATE); both the old and new row remain
 * queryable. On success, refreshes the server component so the page shows
 * the just-inserted row.
 */
export function RecomputeButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/calculation/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const body = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (!res.ok || !body || body.status !== "ok") {
        setError(body?.error ?? "Recalculation failed. Try again.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error while recalculating. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" className={styles.recomputeButton} onClick={() => void handleClick()} disabled={pending}>
        {pending ? "Recalculating…" : "Recalculate"}
      </button>
      {error ? (
        <p className={styles.recomputeError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
