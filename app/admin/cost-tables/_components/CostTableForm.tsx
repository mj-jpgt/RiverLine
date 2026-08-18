"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RESIDENTIAL_ELEMENTS, NON_RESIDENTIAL_ELEMENTS } from "@/core/capture";
import styles from "../../shared.module.css";

type Mode = "form" | "json";
type Status = "idle" | "saving" | "error";

type ValueMap = Record<string, string>;

function emptyValueMap(codes: readonly string[]): ValueMap {
  const map: ValueMap = {};
  for (const c of codes) map[c] = "";
  return map;
}

/** Extracts the {residential, non_residential} candidate from pasted/
 * uploaded JSON. Accepts either the bare payload shape (the engine's
 * EngineCostTable['base_cost_per_sqft']) or a full cost-table document like
 * test/fixtures/engine/cost-table.test-fixture-v0.json (version,
 * source_citation, effective_date, base_cost_per_sqft) — real cost-table
 * files a jurisdiction receives from its cost-estimating guide vendor are
 * plausibly shaped either way. Never fabricates a value; a malformed
 * document simply fails validation with the raw parse error surfaced. */
function extractPayloadCandidate(parsed: unknown): { payload: unknown; meta: { version?: string; sourceCitation?: string; effectiveDateIso?: string } } {
  if (typeof parsed === "object" && parsed !== null && "base_cost_per_sqft" in parsed) {
    const obj = parsed as Record<string, unknown>;
    return {
      payload: obj.base_cost_per_sqft,
      meta: {
        version: typeof obj.version === "string" ? obj.version : undefined,
        sourceCitation: typeof obj.source_citation === "string" ? obj.source_citation : undefined,
        effectiveDateIso: typeof obj.effective_date === "string" ? obj.effective_date : undefined,
      },
    };
  }
  return { payload: parsed, meta: {} };
}

export function CostTableForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("form");
  const [version, setVersion] = useState("");
  const [sourceCitation, setSourceCitation] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [residentialValues, setResidentialValues] = useState<ValueMap>(() =>
    emptyValueMap(RESIDENTIAL_ELEMENTS.map((e) => e.code)),
  );
  const [nonResidentialValues, setNonResidentialValues] = useState<ValueMap>(() =>
    emptyValueMap(NON_RESIDENTIAL_ELEMENTS.map((e) => e.code)),
  );
  const [jsonText, setJsonText] = useState("");
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [touchedVersion, setTouchedVersion] = useState(false);
  const [touchedCitation, setTouchedCitation] = useState(false);
  const [touchedDate, setTouchedDate] = useState(false);
  const [successVersion, setSuccessVersion] = useState<string | null>(null);

  const versionMissing = touchedVersion && version.trim().length === 0;
  const citationMissing = touchedCitation && sourceCitation.trim().length === 0;
  const dateMissing = touchedDate && effectiveDate.trim().length === 0;

  const fieldErrorByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const err of fieldErrors) {
      const m = /^(residential|non_residential)\.([a-z_]+):\s*(.+)$/.exec(err);
      if (m) map[`${m[1]}.${m[2]}`] = m[3] ?? "";
    }
    return map;
  }, [fieldErrors]);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setJsonText(String(reader.result ?? ""));
    };
    reader.readAsText(file);
  }

  function buildFormPayload(): { residential: Record<string, number>; non_residential: Record<string, number> } | null {
    const residential: Record<string, number> = {};
    for (const [code, raw] of Object.entries(residentialValues)) {
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(n)) return null;
      residential[code] = n;
    }
    const non_residential: Record<string, number> = {};
    for (const [code, raw] of Object.entries(nonResidentialValues)) {
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(n)) return null;
      non_residential[code] = n;
    }
    return { residential, non_residential };
  }

  function buildJsonPayload(): unknown | null {
    setJsonParseError(null);
    if (jsonText.trim().length === 0) {
      setJsonParseError("Paste or upload a JSON document first.");
      return null;
    }
    try {
      const parsed = JSON.parse(jsonText);
      const { payload, meta } = extractPayloadCandidate(parsed);
      if (meta.version && version.trim() === "") setVersion(meta.version);
      if (meta.sourceCitation && sourceCitation.trim() === "") setSourceCitation(meta.sourceCitation);
      if (meta.effectiveDateIso && effectiveDate.trim() === "") setEffectiveDate(meta.effectiveDateIso);
      return payload;
    } catch (err) {
      setJsonParseError(err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON.");
      return null;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouchedVersion(true);
    setTouchedCitation(true);
    setTouchedDate(true);
    setFieldErrors([]);
    setErrorMessage("");
    setSuccessVersion(null);

    if (version.trim().length === 0 || sourceCitation.trim().length === 0 || effectiveDate.trim().length === 0) {
      return;
    }

    const payload = mode === "form" ? buildFormPayload() : buildJsonPayload();
    if (payload === null) {
      if (mode === "form") {
        setErrorMessage("Every element needs a number — none can be left blank.");
      }
      return;
    }

    setStatus("saving");
    try {
      const res = await fetch("/api/admin/cost-tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: version.trim(),
          sourceCitation: sourceCitation.trim(),
          effectiveDateIso: effectiveDate.trim(),
          payload,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; fieldErrors?: string[] }
          | null;
        setErrorMessage(body?.error ?? "Could not save the cost table.");
        setFieldErrors(body?.fieldErrors ?? []);
        setStatus("error");
        return;
      }
      const body = (await res.json()) as { version: string };
      setStatus("idle");
      setSuccessVersion(body.version);
      router.refresh();
    } catch {
      setErrorMessage("Network error — check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.noticePanel} role="note">
        <p className={styles.noticeHeading}>FEMA publishes no unit-cost dollar figures</p>
        <p className={styles.noticeText}>
          The SDE 3.0 manual states base cost per square foot must come from the jurisdiction&apos;s own chosen
          cost-estimating guide, contractor estimates, or local permit data — never from this tool. Enter the
          jurisdiction&apos;s real figures below and record where they came from in the source citation. See
          docs/BLOCKERS.md B1.
        </p>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="version">
          Version label (required)
        </label>
        <input
          id="version"
          className={styles.textInput}
          value={version}
          disabled={status === "saving"}
          onChange={(e) => setVersion(e.target.value)}
          onBlur={() => setTouchedVersion(true)}
        />
        {versionMissing ? (
          <p className={styles.fieldError} role="alert">
            A version label is required.
          </p>
        ) : null}
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="source-citation">
          Source citation (required) — name the guide, edition, and page
        </label>
        <textarea
          id="source-citation"
          className={styles.textarea}
          value={sourceCitation}
          disabled={status === "saving"}
          onChange={(e) => setSourceCitation(e.target.value)}
          onBlur={() => setTouchedCitation(true)}
          placeholder="e.g. [Jurisdiction's chosen cost-estimating guide], edition, page — never left blank."
        />
        {citationMissing ? (
          <p className={styles.fieldError} role="alert">
            The source citation cannot be blank — a cost table without a citation is rejected.
          </p>
        ) : null}
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="effective-date">
          Effective date (required)
        </label>
        <input
          id="effective-date"
          type="date"
          className={styles.dateInput}
          value={effectiveDate}
          disabled={status === "saving"}
          onChange={(e) => setEffectiveDate(e.target.value)}
          onBlur={() => setTouchedDate(true)}
        />
        {dateMissing ? (
          <p className={styles.fieldError} role="alert">
            An effective date is required.
          </p>
        ) : null}
      </div>

      <div className={styles.modeToggleRow} role="group" aria-label="Cost entry mode">
        <button
          type="button"
          className={mode === "form" ? styles.modeButtonActive : styles.modeButton}
          aria-pressed={mode === "form"}
          onClick={() => setMode("form")}
        >
          Enter amounts
        </button>
        <button
          type="button"
          className={mode === "json" ? styles.modeButtonActive : styles.modeButton}
          aria-pressed={mode === "json"}
          onClick={() => setMode("json")}
        >
          Paste or upload JSON
        </button>
      </div>

      {mode === "form" ? (
        <>
          <h3 className={styles.elementGroupHeading}>Residential — $ per square foot, all 12 required</h3>
          <div className={styles.elementGrid}>
            {RESIDENTIAL_ELEMENTS.map((el) => (
              <div className={styles.elementField} key={el.code}>
                <label className={styles.elementLabel} htmlFor={`res-${el.code}`}>
                  {el.name} (residential)
                </label>
                <div className={styles.elementInputWrap}>
                  <input
                    id={`res-${el.code}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className={styles.numberInput}
                    value={residentialValues[el.code] ?? ""}
                    disabled={status === "saving"}
                    onChange={(e) =>
                      setResidentialValues((prev) => ({ ...prev, [el.code]: e.target.value }))
                    }
                  />
                  <span className={styles.elementUnit}>$/sq ft</span>
                </div>
                {fieldErrorByCode[`residential.${el.code}`] ? (
                  <p className={styles.fieldError} role="alert">
                    {fieldErrorByCode[`residential.${el.code}`]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <h3 className={styles.elementGroupHeading}>Non-residential — $ per square foot, all 7 required</h3>
          <div className={styles.elementGrid}>
            {NON_RESIDENTIAL_ELEMENTS.map((el) => (
              <div className={styles.elementField} key={el.code}>
                <label className={styles.elementLabel} htmlFor={`nonres-${el.code}`}>
                  {el.name} (non-residential)
                </label>
                <div className={styles.elementInputWrap}>
                  <input
                    id={`nonres-${el.code}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className={styles.numberInput}
                    value={nonResidentialValues[el.code] ?? ""}
                    disabled={status === "saving"}
                    onChange={(e) =>
                      setNonResidentialValues((prev) => ({ ...prev, [el.code]: e.target.value }))
                    }
                  />
                  <span className={styles.elementUnit}>$/sq ft</span>
                </div>
                {fieldErrorByCode[`non_residential.${el.code}`] ? (
                  <p className={styles.fieldError} role="alert">
                    {fieldErrorByCode[`non_residential.${el.code}`]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.formRowWide}>
          <label className={styles.formLabel} htmlFor="json-payload">
            Cost table JSON — must contain all 12 residential + all 7 non-residential element codes
          </label>
          <p className={styles.formHint}>
            Matches the engine&apos;s cost-table shape: <code>{"{ residential: {...}, non_residential: {...} }"}</code>{" "}
            (a full document with <code>base_cost_per_sqft</code> is also accepted).
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            aria-label="Upload cost table JSON file"
            disabled={status === "saving"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <textarea
            id="json-payload"
            className={styles.jsonTextarea}
            value={jsonText}
            disabled={status === "saving"}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="Paste JSON here, or use the file picker above."
          />
          {jsonParseError ? (
            <p className={styles.fieldError} role="alert">
              {jsonParseError}
            </p>
          ) : null}
        </div>
      )}

      {fieldErrors.length > 0 ? (
        <ul className={styles.fieldErrorList} role="alert">
          {fieldErrors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}

      {status === "error" && errorMessage ? (
        <p className={styles.fieldError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      {successVersion ? (
        <div className={styles.successPanel} role="status">
          <p className={styles.statePanelText}>Cost table &quot;{successVersion}&quot; saved.</p>
        </div>
      ) : null}

      <button type="submit" className={styles.primaryButton} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save cost table"}
      </button>
    </form>
  );
}
