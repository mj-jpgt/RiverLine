"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EnrichmentSuggestion } from "@/core/registry";
import { LoadingIndicator } from "@/shared/ui";
import styles from "./page.module.css";

type Status = "idle" | "checking" | "ready" | "unavailable" | "saving" | "error";

interface Props {
  structureId: string;
  /** Whether at least one enrichable field is currently blank — drives the
   * automatic on-load check the task calls for ("automatic prefill at
   * assessment start when fields are missing"). When every field is
   * already on file, this panel never fetches or renders anything. */
  hasMissingFields: boolean;
}

/**
 * "Refresh from county records": fetches the live Hamilton County parcel
 * record for this structure and shows each blank field it can fill as an
 * editable, individually-acceptable suggestion with source + fetch date.
 * Nothing is written to the database until the assessor accepts a specific
 * field — this panel never auto-saves. If the county service is
 * unreachable, this renders nothing alarming: just the manual-entry fields
 * already on the page above, unchanged (offline-first / "degrade silently").
 */
export function EnrichmentPanel({ structureId, hasMissingFields }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [suggestions, setSuggestions] = useState<EnrichmentSuggestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [accepting, setAccepting] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function checkCounty() {
    setStatus("checking");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/registry/${structureId}/enrich`);
      if (!res.ok) {
        setStatus("unavailable");
        return;
      }
      const body = (await res.json()) as {
        available: boolean;
        fetchedAt: string | null;
        suggestions: EnrichmentSuggestion[];
      };
      if (!body.available || body.suggestions.length === 0) {
        setStatus("unavailable");
        return;
      }
      setSuggestions(body.suggestions);
      setDrafts(Object.fromEntries(body.suggestions.map((s) => [s.field, String(s.suggestedValue)])));
      setStatus("ready");
    } catch {
      setStatus("unavailable");
    }
  }

  // Automatic check on mount, only when there is something worth checking
  // for. This is the "automatic prefill at assessment start" behavior: the
  // structure detail page is where an assessor lands right before "Start
  // assessment," so a silent background check here is effectively
  // assessment-start prefill without moving any logic into the capture
  // module (src/core/capture/ is a different agent's module).
  useEffect(() => {
    if (hasMissingFields) {
      checkCounty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function accept(field: string) {
    setAccepting(field);
    setErrorMessage("");
    try {
      const suggestion = suggestions.find((s) => s.field === field);
      if (!suggestion) return;
      const res = await fetch(`/api/registry/${structureId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accepted: { [field]: drafts[field] ?? suggestion.suggestedValue },
          sourceLabel: suggestion.sourceLabel,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not save. Try again.");
        setAccepting(null);
        return;
      }
      setSuggestions((prev) => prev.filter((s) => s.field !== field));
      router.refresh();
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
    } finally {
      setAccepting(null);
    }
  }

  if (status === "idle" && !hasMissingFields) return null;
  if (status === "idle" || status === "checking") {
    return (
      <div className={styles.enrichPanel} role="status" aria-live="polite">
        <p className={styles.enrichChecking}>Checking the county record for missing fields…</p>
        <LoadingIndicator />
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className={styles.enrichPanel}>
        <p className={styles.enrichUnavailable}>
          No suggestions from the county record right now. Enter values by hand below, or try again.
        </p>
        <button type="button" className={styles.enrichRetry} onClick={checkCounty}>
          Refresh from county records
        </button>
      </div>
    );
  }

  if (suggestions.length === 0) return null;

  return (
    <div className={styles.enrichPanel}>
      <p className={styles.enrichHeading}>Suggested from the county record</p>
      <p className={styles.enrichSubtext}>
        These come from the county assessor&apos;s parcel record. Review each one, edit it if needed,
        then accept it. Nothing is saved until you accept it, and this never changes a field you have
        already filled in.
      </p>
      <ul className={styles.enrichList}>
        {suggestions.map((s) => (
          <li key={s.field} className={styles.enrichItem}>
            <label className={styles.enrichLabel} htmlFor={`enrich-${s.field}`}>
              {s.label}
            </label>
            <div className={styles.enrichRow}>
              <input
                id={`enrich-${s.field}`}
                type="text"
                inputMode={s.field === "propClass" || s.field === "occupancyType" ? "text" : "numeric"}
                value={drafts[s.field] ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [s.field]: e.target.value }))}
                className={styles.enrichInput}
              />
              <button
                type="button"
                className={styles.enrichAccept}
                disabled={accepting === s.field}
                onClick={() => accept(s.field)}
              >
                {accepting === s.field ? "Saving…" : "Accept"}
              </button>
            </div>
            <p className={styles.enrichSource}>{s.sourceLabel}</p>
          </li>
        ))}
      </ul>
      {errorMessage ? (
        <p className={styles.enrichError} role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
