"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../review.module.css";

type Status = "idle" | "confirming" | "saving" | "error";

// THE TOOL PROPOSES, THE OFFICIAL ADOPTS. Explicit action, confirmation
// step before adopt (task requirement 4; docs/design/components.md
// "Confirmation dialog" row: "adoption itself is not reversible — the
// dialog copy must say so plainly, not softened"). This component is the
// ONLY UI path that can reach the adopt route, and that route itself
// refuses without `confirmed: true` — never a single accidental tap.
export function AdoptAction({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function confirmAdopt() {
    setStatus("saving");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/determination/${encodeURIComponent(clientId)}/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not adopt this determination.");
        setStatus("error");
        return;
      }
      router.refresh();
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "idle" || status === "error") {
    return (
      <div>
        <button type="button" className={styles.adoptButton} onClick={() => setStatus("confirming")}>
          Adopt determination
        </button>
        {status === "error" ? (
          <p className={styles.fieldError} role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.confirmPanel} role="alertdialog" aria-label="Confirm adoption">
      <p className={styles.confirmHeading}>Confirm adoption</p>
      <p className={styles.confirmBody}>
        Adopting this determination records it as the official finding of record, with your user account and the
        current time. <strong>This cannot be undone.</strong> A mistaken determination must be corrected through the
        Supersede action afterward, which creates a new draft rather than editing this one.
      </p>
      <div className={styles.overrideActions}>
        <button type="button" className={styles.adoptButton} disabled={status === "saving"} onClick={confirmAdopt}>
          {status === "saving" ? "Adopting…" : "Yes, adopt this determination"}
        </button>
        <button
          type="button"
          className={styles.overrideCancelButton}
          disabled={status === "saving"}
          onClick={() => setStatus("idle")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
