"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

type Status = "idle" | "saving" | "error";

// Admin-role path to enter the two known data gaps this module refuses on
// (specs/constitution.md #2): jurisdictions.ordinance_citation and
// letterhead_config.appeal_window_days. Writes are audited server-side
// (app/letters/[clientId]/ordinance/route.ts -> setOrdinanceCitation).
// This form NEVER ships a placeholder/example citation string in its
// initial value or its placeholder text that could look like a real one —
// the field starts empty.
export function OrdinanceForm({ clientId, jurisdictionName }: { clientId: string; jurisdictionName: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [citation, setCitation] = useState("");
  const [appealWindowDays, setAppealWindowDays] = useState("");
  const [citationMissing, setCitationMissing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (citation.trim().length === 0) {
      setCitationMissing(true);
      return;
    }
    setStatus("saving");
    setErrorMessage("");
    try {
      const res = await fetch(`/letters/${encodeURIComponent(clientId)}/ordinance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordinanceCitation: citation,
          appealWindowDays: appealWindowDays.trim() === "" ? null : Number(appealWindowDays),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not save the ordinance citation.");
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
    <form className={styles.ordinanceForm} onSubmit={submit}>
      <p className={styles.ordinanceFormHeading}>Enter {jurisdictionName}&apos;s floodplain ordinance citation</p>

      <label className={styles.formLabel} htmlFor="ordinance-citation">
        Ordinance citation (verbatim, required)
      </label>
      <textarea
        id="ordinance-citation"
        className={styles.ordinanceTextarea}
        value={citation}
        disabled={status === "saving"}
        onChange={(e) => {
          setCitation(e.target.value);
          if (e.target.value.trim().length > 0) setCitationMissing(false);
        }}
        placeholder="Paste the jurisdiction's own adopted ordinance text here, verbatim. Do not paraphrase or invent."
      />
      {citationMissing ? (
        <p className={styles.fieldError} role="alert">
          The ordinance citation is required — it cannot be left blank.
        </p>
      ) : null}

      <label className={styles.formLabel} htmlFor="appeal-window-days">
        Appeal window (days) — optional
      </label>
      <input
        id="appeal-window-days"
        type="number"
        inputMode="numeric"
        min={1}
        className={styles.numberInput}
        value={appealWindowDays}
        disabled={status === "saving"}
        onChange={(e) => setAppealWindowDays(e.target.value)}
        placeholder="e.g. 30"
      />

      {status === "error" ? (
        <p className={styles.fieldError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button type="submit" className={styles.primaryButton} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save ordinance citation"}
      </button>
    </form>
  );
}
