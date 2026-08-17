"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../review.module.css";

type Status = "idle" | "editing" | "saving" | "error";
type ValueSource = "official_override" | "appraisal";

// Market value override — e.g. the official has an independent appraisal.
// Sets value + value_source (task requirement 3(b)), reason mandatory,
// audited, re-runs the engine into a new calculations row.
export function OverrideValueControl({
  clientId,
  currentValue,
  disabled,
}: {
  clientId: string;
  currentValue: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [value, setValue] = useState(currentValue);
  const [valueSource, setValueSource] = useState<ValueSource>("appraisal");
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
          setValue(currentValue);
          setReason("");
          setErrorMessage("");
          setReasonMissing(false);
        }}
      >
        Override market value
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
      const res = await fetch(`/api/determination/${encodeURIComponent(clientId)}/override-value`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, valueSource, reason }),
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
      setErrorMessage("Network error — check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <div className={styles.overridePanel}>
      <p className={styles.overrideHeading}>Override market value</p>

      <label className={styles.overrideLabel} htmlFor="override-value">
        Market value (USD)
      </label>
      <input
        id="override-value"
        type="number"
        inputMode="decimal"
        min={0.01}
        step="0.01"
        className={styles.overrideNumberInput}
        value={value}
        disabled={status === "saving"}
        onChange={(e) => setValue(Math.max(0, Number(e.target.value) || 0))}
      />

      <span className={styles.overrideLabel}>Value source</span>
      <div className={styles.valueSourceButtons} role="group" aria-label="Value source">
        <button
          type="button"
          className={valueSource === "appraisal" ? styles.optionButtonSelected : styles.optionButton}
          disabled={status === "saving"}
          onClick={() => setValueSource("appraisal")}
        >
          Independent appraisal
        </button>
        <button
          type="button"
          className={valueSource === "official_override" ? styles.optionButtonSelected : styles.optionButton}
          disabled={status === "saving"}
          onClick={() => setValueSource("official_override")}
        >
          Official override
        </button>
      </div>

      <label className={styles.overrideLabel} htmlFor="override-value-reason">
        Reason for override (required)
      </label>
      <textarea
        id="override-value-reason"
        className={styles.overrideReasonInput}
        value={reason}
        disabled={status === "saving"}
        onChange={(e) => {
          setReason(e.target.value);
          if (e.target.value.trim().length > 0) setReasonMissing(false);
        }}
        placeholder="e.g. Owner-provided appraisal dated ... supersedes assessed value for this determination."
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
