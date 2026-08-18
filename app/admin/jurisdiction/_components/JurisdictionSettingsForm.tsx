"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../shared.module.css";
import type { JurisdictionSettings } from "@/core/admin";

type Status = "idle" | "saving" | "error" | "success";

/** Admin-only jurisdiction settings form: ordinance citation, appeal
 * window, letterhead name/address, optional ICC text. Prefilled with the
 * REAL currently-saved values (never a fabricated example — this is
 * showing back what a human already entered, the same as any edit form),
 * writes through POST /api/admin/jurisdiction (src/core/admin's
 * updateJurisdictionSettings), a parallel path to
 * src/modules/a1-letters/actions.ts's setOrdinanceCitation that owns the
 * SAME jurisdictions columns/letterhead_config keys, so app/letters keeps
 * reading correctly with zero changes to that module. */
export function JurisdictionSettingsForm({ initial }: { initial: JurisdictionSettings }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [citation, setCitation] = useState(initial.ordinanceCitation ?? "");
  const [appealWindowDays, setAppealWindowDays] = useState(
    initial.appealWindowDays !== null ? String(initial.appealWindowDays) : "",
  );
  const [letterheadName, setLetterheadName] = useState(initial.letterheadName ?? "");
  const [addressLines, setAddressLines] = useState(initial.addressLines.join("\n"));
  const [iccText, setIccText] = useState(initial.iccText ?? "");
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
      const res = await fetch("/api/admin/jurisdiction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordinanceCitation: citation,
          appealWindowDays: appealWindowDays.trim() === "" ? null : Number(appealWindowDays),
          letterheadName: letterheadName.trim() === "" ? null : letterheadName,
          addressLines:
            addressLines.trim() === ""
              ? null
              : addressLines
                  .split("\n")
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0),
          iccText: iccText.trim() === "" ? null : iccText,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not save jurisdiction settings.");
        setStatus("error");
        return;
      }
      setStatus("success");
      router.refresh();
    } catch {
      setErrorMessage("Network error — check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formRowWide}>
        <label className={styles.formLabel} htmlFor="ordinance-citation">
          Ordinance citation (verbatim, required)
        </label>
        <p className={styles.formHint}>
          Paste the jurisdiction&apos;s own adopted ordinance text exactly as written — this goes into determination
          letters verbatim. Never paraphrase or invent. See docs/BLOCKERS.md B2.
        </p>
        <textarea
          id="ordinance-citation"
          className={styles.jsonTextarea}
          value={citation}
          disabled={status === "saving"}
          onChange={(e) => {
            setCitation(e.target.value);
            if (e.target.value.trim().length > 0) setCitationMissing(false);
          }}
        />
        {citationMissing ? (
          <p className={styles.fieldError} role="alert">
            The ordinance citation is required — it cannot be left blank.
          </p>
        ) : null}
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="appeal-window-days">
          Appeal window (days) — leave blank to unset
        </label>
        <input
          id="appeal-window-days"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          className={styles.numberInput}
          value={appealWindowDays}
          disabled={status === "saving"}
          onChange={(e) => setAppealWindowDays(e.target.value)}
        />
        <p className={styles.formHint}>
          Blank = unset: appeal_deadline_date stays null on every determination until this is configured.
        </p>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="letterhead-name">
          Letterhead name — shown at the top of determination letters (optional)
        </label>
        <input
          id="letterhead-name"
          className={styles.textInput}
          value={letterheadName}
          disabled={status === "saving"}
          onChange={(e) => setLetterheadName(e.target.value)}
        />
      </div>

      <div className={styles.formRowWide}>
        <label className={styles.formLabel} htmlFor="address-lines">
          Letterhead address — one line per row (optional)
        </label>
        <textarea
          id="address-lines"
          className={styles.textarea}
          value={addressLines}
          disabled={status === "saving"}
          onChange={(e) => setAddressLines(e.target.value)}
        />
      </div>

      <div className={styles.formRowWide}>
        <label className={styles.formLabel} htmlFor="icc-text">
          Increased Cost of Compliance (ICC) paragraph — optional
        </label>
        <p className={styles.formHint}>
          The jurisdiction supplies this text; it is never authored by this tool. Left blank, letters omit the ICC
          paragraph entirely.
        </p>
        <textarea
          id="icc-text"
          className={styles.textarea}
          value={iccText}
          disabled={status === "saving"}
          onChange={(e) => setIccText(e.target.value)}
        />
      </div>

      {status === "error" && errorMessage ? (
        <p className={styles.fieldError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      {status === "success" ? (
        <div className={styles.successPanel} role="status">
          <p className={styles.statePanelText}>Jurisdiction settings saved.</p>
        </div>
      ) : null}

      <button type="submit" className={styles.primaryButton} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save jurisdiction settings"}
      </button>
    </form>
  );
}
