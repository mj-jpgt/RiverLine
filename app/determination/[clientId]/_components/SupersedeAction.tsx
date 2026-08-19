"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../review.module.css";

type Status = "idle" | "editing" | "saving" | "error";

// After adoption: read-only view + Supersede action (task requirement 4).
// Creates a new draft determination pointing at a fresh calculation; the
// old one becomes status='superseded' — never deleted (AGENTS.md rule 11).
// Reason mandatory, matching the override actions' audited pattern for a
// legally-consequential reversal of an adopted determination.
export function SupersedeAction({ determinationId }: { determinationId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [reason, setReason] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (status === "idle" || status === "error") {
    return (
      <div>
        <button
          type="button"
          className={styles.overrideCancelButton}
          onClick={() => {
            setStatus("editing");
            setReason("");
            setReasonMissing(false);
          }}
        >
          Supersede this determination
        </button>
        {status === "error" ? (
          <p className={styles.fieldError} role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }

  async function submit() {
    if (reason.trim().length === 0) {
      setReasonMissing(true);
      return;
    }
    setStatus("saving");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/determination/supersede/${encodeURIComponent(determinationId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not supersede this determination.");
        setStatus("error");
        return;
      }
      router.refresh();
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <div className={styles.confirmPanel} role="alertdialog" aria-label="Confirm supersede">
      <p className={styles.confirmHeading}>Supersede this determination</p>
      <p className={styles.confirmBody}>
        This adopted determination will be marked <strong>superseded</strong> (kept on file, never deleted) and a new
        draft determination will be created from a freshly computed calculation for you to review and adopt.
      </p>
      <label className={styles.overrideLabel} htmlFor="supersede-reason">
        Reason for superseding (required)
      </label>
      <textarea
        id="supersede-reason"
        className={styles.overrideReasonInput}
        value={reason}
        disabled={status === "saving"}
        onChange={(e) => {
          setReason(e.target.value);
          if (e.target.value.trim().length > 0) setReasonMissing(false);
        }}
        placeholder="e.g. Owner appeal produced new evidence requiring re-review."
      />
      {reasonMissing ? (
        <p className={styles.fieldError} role="alert">
          A reason is required to supersede this determination.
        </p>
      ) : null}
      <div className={styles.overrideActions}>
        <button type="button" className={styles.adoptButton} disabled={status === "saving"} onClick={submit}>
          {status === "saving" ? "Saving…" : "Yes, supersede this determination"}
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
