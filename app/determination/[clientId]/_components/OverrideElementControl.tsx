"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../review.module.css";

type Status = "idle" | "editing" | "saving" | "error";

// Per-element damage-% override — audited, reason mandatory. An override
// re-runs the engine and INSERTS a new calculations row (task requirement
// 3(a)); the control must not submit without a reason (empty reason is
// blocked here client-side AND server-side —
// app/api/determination/[clientId]/override-element/route.ts rejects it
// too, so this is real validation, not decoration).
export function OverrideElementControl({
  clientId,
  elementCode,
  elementName,
  currentDamagePct,
  disabled,
}: {
  clientId: string;
  elementCode: string;
  elementName: string;
  currentDamagePct: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [damagePct, setDamagePct] = useState(currentDamagePct);
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [reasonMissing, setReasonMissing] = useState(false);

  if (disabled) return null;

  if (status === "idle") {
    return (
      <button
        type="button"
        className={styles.overrideToggleButton}
        onClick={() => {
          setStatus("editing");
          setDamagePct(currentDamagePct);
          setReason("");
          setErrorMessage("");
          setReasonMissing(false);
        }}
      >
        Override {elementName}
      </button>
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
      const res = await fetch(`/api/determination/${encodeURIComponent(clientId)}/override-element`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elementCode, damagePct, reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not save the override.");
        setStatus("error");
        return;
      }
      setStatus("idle");
      router.refresh();
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <div className={styles.overridePanel}>
      <p className={styles.overrideHeading}>Override {elementName} damage %</p>
      <label className={styles.overrideLabel} htmlFor={`override-pct-${elementCode}`}>
        New damage percentage (0-100)
      </label>
      <input
        id={`override-pct-${elementCode}`}
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        className={styles.overrideNumberInput}
        value={damagePct}
        disabled={status === "saving"}
        onChange={(e) => setDamagePct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
      />

      <label className={styles.overrideLabel} htmlFor={`override-reason-${elementCode}`}>
        Reason for override (required)
      </label>
      <textarea
        id={`override-reason-${elementCode}`}
        className={styles.overrideReasonInput}
        value={reason}
        disabled={status === "saving"}
        onChange={(e) => {
          setReason(e.target.value);
          if (e.target.value.trim().length > 0) setReasonMissing(false);
        }}
        placeholder="e.g. Field re-inspection found additional interior finish damage not captured at initial visit."
      />
      {reasonMissing ? (
        <p className={styles.fieldError} role="alert">
          A reason is required to save this override.
        </p>
      ) : null}
      {status === "error" ? (
        <p className={styles.fieldError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.overrideActions}>
        <button type="button" className={styles.overrideSaveButton} disabled={status === "saving"} onClick={submit}>
          {status === "saving" ? "Saving…" : "Save override"}
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
