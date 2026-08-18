"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { RegistryNearbyResult, RegistrySearchResult } from "@/core/registry";
import { LoadingIndicator } from "@/shared/ui";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

type Mode = "search" | "near";
type LoadState = "idle" | "loading" | "loaded" | "error";

const SEARCH_DEBOUNCE_MS = 300;
const METERS_PER_MILE = 1609.344;

function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `${Math.round(meters)} m`;
  return `${miles.toFixed(1)} mi`;
}

function formatValue(value: number | null): string {
  if (value === null) return "No value on file";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function RegistrySearch() {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("search");
  const [state, setState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchResults, setSearchResults] = useState<RegistrySearchResult[]>([]);
  const [nearResults, setNearResults] = useState<RegistryNearbyResult[]>([]);
  const [locating, setLocating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (mode !== "search") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setState("idle");
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setState("loading");
      setErrorMessage("");
      try {
        const res = await fetch(`/api/registry/search?q=${encodeURIComponent(trimmed)}`);
        if (requestId !== requestIdRef.current) return; // stale response
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setErrorMessage(body?.error ?? "Search failed. Try again.");
          setState("error");
          return;
        }
        const body = (await res.json()) as { results: RegistrySearchResult[] };
        setSearchResults(body.results);
        setState("loaded");
      } catch {
        if (requestId !== requestIdRef.current) return;
        setErrorMessage("Network error. Check your connection and try again.");
        setState("error");
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode]);

  async function handleUseLocation() {
    setMode("near");
    setLocating(true);
    setState("loading");
    setErrorMessage("");

    if (!("geolocation" in navigator)) {
      setLocating(false);
      setErrorMessage("This browser does not support location services.");
      setState("error");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setLocating(false);
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(`/api/registry/near?lat=${latitude}&lng=${longitude}`);
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            setErrorMessage(body?.error ?? "Could not find nearby structures.");
            setState("error");
            return;
          }
          const body = (await res.json()) as { results: RegistryNearbyResult[] };
          setNearResults(body.results);
          setState("loaded");
        } catch {
          setErrorMessage("Network error. Check your connection and try again.");
          setState("error");
        }
      },
      (geoError) => {
        setLocating(false);
        const message =
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location access was denied. Allow location access, or search by address instead."
            : "Could not determine your location. Search by address instead.";
        setErrorMessage(message);
        setState("error");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handleQueryChange(value: string) {
    setMode("search");
    setQuery(value);
  }

  const results = mode === "near" ? nearResults : searchResults;

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
          placeholder="e.g. 1355 S 10th St"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          className={styles.input}
        />
      </div>

      <button
        type="button"
        onClick={handleUseLocation}
        disabled={locating}
        className={styles.locateButton}
      >
        {locating ? "Finding your location…" : "Use my location: nearest structures"}
      </button>

      {state === "idle" ? (
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>
            Start typing an address (2+ characters), or use your location to
            find the nearest structures on record.
          </p>
        </div>
      ) : null}

      {state === "loading" ? (
        <div className={styles.statePanel} role="status" aria-live="polite">
          <p className={styles.statePanelText}>
            {mode === "near" ? "Searching nearby structures…" : "Searching…"}
          </p>
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
            {mode === "near"
              ? "No structures match near your current location."
              : "No structures match that address."}
          </p>
          {mode === "search" ? (
            <Link
              href={`/registry/new${query.trim() ? `?address=${encodeURIComponent(query.trim())}` : ""}`}
              className={styles.notFoundLink}
            >
              Structure not found? Add it by hand
            </Link>
          ) : null}
        </div>
      ) : null}

      {state === "loaded" && results.length > 0 ? (
        <div className={motion.fadeIn}>
          <p className={styles.resultsHeading}>
            {mode === "near" ? "Nearest structures" : `${results.length} match${results.length === 1 ? "" : "es"}`}
          </p>
          <ul className={styles.resultsList}>
            {results.map((result) => (
              <li key={result.id} className={styles.resultItem}>
                <Link href={`/registry/${result.id}`} className={styles.resultLink}>
                  <span className={styles.resultMain}>
                    <span className={styles.resultAddress}>{result.address}</span>
                    <span className={styles.resultDifferentiators}>
                      Parcel {result.parcelId}
                      {result.propClass ? ` · Class ${result.propClass}` : ""}
                      {" · "}
                      {formatValue(result.improvementValue)}
                    </span>
                    {result.isManualEntry ? (
                      <span className={styles.resultManualBadge}>Unverified manual entry</span>
                    ) : null}
                  </span>
                  <span className={styles.resultMeta}>
                    {"distanceMeters" in result ? (
                      <span className={styles.resultDistance}>
                        {formatDistance((result as RegistryNearbyResult).distanceMeters)}
                      </span>
                    ) : null}
                    {result.sfhaZone ? (
                      <span className={styles.resultZone}>Zone {result.sfhaZone}</span>
                    ) : null}
                    {!result.occupancyType ? (
                      <span className={styles.resultOccupancyUnset}>Occupancy unset</span>
                    ) : null}
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
