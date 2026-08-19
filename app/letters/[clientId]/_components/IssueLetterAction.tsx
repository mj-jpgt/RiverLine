"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

type Status = "idle" | "confirming" | "saving" | "error";

// Issuing creates the permanent, archived letter record (a `letters` row +
// an audited copy of the rendered HTML) and links it to the determination —
// a two-step confirm, same pattern as
// app/determination/[clientId]/_components/AdoptAction.tsx, because it is
// not meaningfully reversible (the archived copy is the record of what was
// actually mailed).
export function IssueLetterAction({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function confirmIssue() {
    setStatus("saving");
    setErrorMessage("");
    try {
      const res = await fetch(`/letters/${encodeURIComponent(clientId)}/issue`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not issue this letter.");
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
        <button type="button" className={styles.primaryButton} onClick={() => setStatus("confirming")}>
          Issue letter
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
    <div className={styles.confirmPanel} role="alertdialog" aria-label="Confirm issue letter">
      <p className={styles.confirmHeading}>Confirm issue letter</p>
      <p className={styles.statePanelText}>
        Issuing creates the permanent record of this letter: an archived copy of the exact text generated now. This
        cannot be undone.
      </p>
      <div className={styles.actionsRow}>
        <button type="button" className={styles.primaryButton} disabled={status === "saving"} onClick={confirmIssue}>
          {status === "saving" ? "Issuing…" : "Yes, issue this letter"}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={status === "saving"}
          onClick={() => setStatus("idle")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
