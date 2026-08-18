"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { AssessmentListRow } from "@/modules/a4-estimates";
import { LoadingIndicator } from "@/shared/ui";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

type LoadState = "idle" | "loading" | "loaded" | "error";
const SEARCH_DEBOUNCE_MS = 300;

function formatDate(iso: string | null): string {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Same shape as app/registry/RegistrySearch.tsx: debounced fetch, real
// loading/empty/error states (no blank areas, direction.md "Smooth, not
// decorative" #6). Lists recently-completed assessments up front (empty
// query still returns the most recent 50 via
// src/modules/a4-estimates/queries.ts's searchAssessmentsForEstimates), so
// the page is never blank on first load.
export function EstimatesSearch() {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [results, setResults] = useState<AssessmentListRow[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setState("loading");
      setErrorMessage("");
      try {
        const trimmed = query.trim();
        const res = await fetch(`/api/estimates/search${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ""}`);
        if (requestId !== requestIdRef.current) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setErrorMessage(body?.error ?? "Search failed. Try again.");
          setState("error");
          return;
        }
        const body = (await res.json()) as { results: AssessmentListRow[] };
        setResults(body.results);
        setState("loaded");
      } catch {
        if (requestId !== requestIdRef.current) return;
        setErrorMessage("Network error — check your connection and try again.");
        setState("error");
      }
    }, query.trim().length === 0 ? 0 : SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div>
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.label}>
          Address
        </label>
        <input
          id={inputId}
          type="search"
          inputMode="text"
          autoComplete="off"
          placeholder="e.g. 123 Practice Ln"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.input}
        />
      </div>

      {state === "loading" ? (
        <div className={styles.statePanel} role="status" aria-live="polite">
          <p className={styles.statePanelText}>Searching…</p>
          <LoadingIndicator />
        </div>
      ) : null}

      {state === "error" ? (
        <div className={styles.errorPanel} role="alert">
          <p className={styles.statePanelText}>{errorMessage}</p>
        </div>
      ) : null}

      {state === "loaded" && results.length === 0 ? (
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>
            No completed assessments match that address. An assessment must be
            captured and synced (via the field capture flow) before an
            estimate can be attached to it.
          </p>
        </div>
      ) : null}

      {state === "loaded" && results.length > 0 ? (
        <div className={motion.fadeIn}>
          <p className={styles.resultsHeading}>
            {results.length} assessment{results.length === 1 ? "" : "s"}
          </p>
          <ul className={styles.resultsList}>
            {results.map((r) => (
              <li key={r.clientId} className={styles.resultItem}>
                <Link href={`/estimates/${encodeURIComponent(r.clientId)}`} className={styles.resultLink}>
                  <span className={styles.resultAddress}>{r.address}</span>
                  <span className={styles.resultMeta}>
                    {formatDate(r.completedAtIso)} · {r.estimateCount} estimate{r.estimateCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
