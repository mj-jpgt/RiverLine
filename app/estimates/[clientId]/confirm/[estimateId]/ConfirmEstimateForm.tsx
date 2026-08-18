"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// Imported from the specific client-safe submodules, NOT the module's
// barrel index.ts — see EstimateUploadFlow.tsx's file header for why
// (the barrel also re-exports actions.ts/queries.ts, which need "pg" and
// cannot resolve in a client bundle).
import { checkSanityBound, reconcileLineItemsAgainstTotal } from "@/modules/a4-estimates/parser";
import type {
  CandidateLineItem,
  CandidateTotal,
  ConfirmedLineItem,
  EstimatePageStorage,
  ExtractedJson,
} from "@/modules/a4-estimates/types";
import styles from "../../new/new.module.css";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

interface FocusedBox {
  pageIndex: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface ManualLine {
  id: string;
  description: string;
  amount: string;
}

let manualLineCounter = 0;
function newManualLine(): ManualLine {
  manualLineCounter += 1;
  return { id: `manual-${manualLineCounter}`, description: "", amount: "" };
}

export function ConfirmEstimateForm({
  clientId,
  estimateId,
  pages,
  extracted,
  structureImprovementValue,
}: {
  clientId: string;
  estimateId: string;
  pages: EstimatePageStorage[];
  extracted: ExtractedJson | null;
  structureImprovementValue: number | null;
}) {
  const router = useRouter();
  const lineItems: CandidateLineItem[] = extracted?.lineItems ?? [];
  const candidateTotals: CandidateTotal[] = extracted?.candidateTotals ?? [];
  const hasOcrCandidates = lineItems.length > 0 || candidateTotals.length > 0;

  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [selectedTotalId, setSelectedTotalId] = useState<string | null>(null);
  const [focusedBox, setFocusedBox] = useState<FocusedBox | null>(null);
  const [manualMode, setManualMode] = useState(!hasOcrCandidates);
  const [manualTotal, setManualTotal] = useState("");
  const [manualLines, setManualLines] = useState<ManualLine[]>([newManualLine()]);
  const [scopeReviewed, setScopeReviewed] = useState(false);
  const [sanityAcknowledged, setSanityAcknowledged] = useState(false);
  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  function toggleIncluded(id: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleVerified(id: string) {
    setVerified((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function focusRow(item: CandidateLineItem | CandidateTotal) {
    setSelectedPageIndex(item.pageIndex);
    setFocusedBox({ pageIndex: item.pageIndex, ...item.bbox });
  }

  const includedItems = lineItems.filter((li) => included.has(li.id) && li.amountDollars !== null);
  const allIncludedVerified = includedItems.every((li) => verified.has(li.id));
  const selectedTotalCandidate = candidateTotals.find((t) => t.id === selectedTotalId) ?? null;

  const manualTotalDollars = Number(manualTotal);
  const manualValidLines = manualLines.filter(
    (l) => l.description.trim().length > 0 && Number.isFinite(Number(l.amount)) && l.amount.trim().length > 0,
  );

  const effectiveTotalDollars = manualMode
    ? manualTotal.trim().length > 0 && Number.isFinite(manualTotalDollars) ? manualTotalDollars : null
    : selectedTotalCandidate?.amountDollars ?? null;

  const confirmedLineItems: ConfirmedLineItem[] = manualMode
    ? manualValidLines.map((l) => ({ description: l.description.trim(), amountDollars: Number(l.amount) }))
    : includedItems.map((li) => ({ description: li.description, amountDollars: li.amountDollars as number }));

  const reconciliation = useMemo(() => {
    if (confirmedLineItems.length === 0 || effectiveTotalDollars === null) return null;
    return reconcileLineItemsAgainstTotal(
      confirmedLineItems.map((li) => li.amountDollars),
      effectiveTotalDollars,
    );
  }, [confirmedLineItems, effectiveTotalDollars]);

  const sanity = useMemo(() => {
    if (effectiveTotalDollars === null) return { exceedsBound: null, thresholdDollars: null };
    return checkSanityBound(effectiveTotalDollars, structureImprovementValue);
  }, [effectiveTotalDollars, structureImprovementValue]);

  const totalSelected = manualMode ? effectiveTotalDollars !== null && effectiveTotalDollars > 0 : selectedTotalId !== null;
  // `includedItems.every(...)` on an EMPTY array is vacuously true — real
  // bug caught by this task's own e2e run: tapping the total alone (before
  // including/verifying any line item) must NOT already satisfy the gate
  // when real candidate line items exist to review. If OCR genuinely found
  // none at all (lineItems.length === 0), there is nothing to gate on.
  const ocrGateOk = manualMode || ((lineItems.length === 0 || includedItems.length > 0) && allIncludedVerified);
  const mismatchGateOk = !reconciliation || reconciliation.reconciles || mismatchAcknowledged;
  const sanityGateOk = sanity.exceedsBound !== true || sanityAcknowledged;

  const canConfirm =
    scopeReviewed &&
    totalSelected &&
    effectiveTotalDollars !== null &&
    effectiveTotalDollars > 0 &&
    ocrGateOk &&
    mismatchGateOk &&
    sanityGateOk &&
    submitState !== "submitting";

  async function handleConfirm() {
    if (!canConfirm || effectiveTotalDollars === null) return;
    setSubmitState("submitting");
    setErrorMessage("");
    try {
      const res = await fetch(`/api/estimates/document/${estimateId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedTotal: effectiveTotalDollars,
          confirmedLineItems,
          scopeReviewed,
          provenance: manualMode ? "manual_entry" : "ocr_assisted",
          notes: notes.trim().length > 0 ? notes.trim() : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not save the confirmation.");
        setSubmitState("error");
        return;
      }
      router.push(`/estimates/${encodeURIComponent(clientId)}`);
    } catch {
      setErrorMessage("Network error — check your connection and try again.");
      setSubmitState("error");
    }
  }

  const currentPageExtracted = extracted?.pages[selectedPageIndex] ?? null;

  return (
    <div className={styles.confirmLayout}>
      {pages.length > 1 ? (
        <div className={styles.pageTabs}>
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              className={i === selectedPageIndex ? styles.pageTabSelected : styles.pageTab}
              onClick={() => setSelectedPageIndex(i)}
            >
              Page {i + 1}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.imageColumn}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/estimates/document/${estimateId}/image/${selectedPageIndex}`}
          alt={`Estimate document page ${selectedPageIndex + 1}`}
          className={styles.pageImage}
        />
        {currentPageExtracted ? (
          <svg
            className={styles.highlightOverlay}
            viewBox={`0 0 ${currentPageExtracted.imageWidthPx} ${currentPageExtracted.imageHeightPx}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {focusedBox && focusedBox.pageIndex === selectedPageIndex ? (
              <rect
                x={focusedBox.x0}
                y={focusedBox.y0}
                width={Math.max(1, focusedBox.x1 - focusedBox.x0)}
                height={Math.max(1, focusedBox.y1 - focusedBox.y0)}
                className={styles.highlightRect}
              />
            ) : null}
          </svg>
        ) : null}
      </div>

      {!manualMode ? (
        <>
          <section>
            <h2 className={styles.sectionHeading}>Which row is the total?</h2>
            <p className={styles.sectionSubtext}>
              Tap the row on the document that is the correct total for this estimate. This is never chosen
              automatically.
            </p>
            {candidateTotals.length === 0 ? (
              <p className={styles.emptyCandidatesNote}>
                No total-looking line was found automatically. Switch to manual entry below.
              </p>
            ) : (
              candidateTotals.map((t) => (
                <label
                  key={t.id}
                  className={selectedTotalId === t.id ? styles.candidateRowFocused : styles.candidateRow}
                  onMouseEnter={() => focusRow(t)}
                  onFocus={() => focusRow(t)}
                >
                  <input
                    type="radio"
                    name="selected-total"
                    className={styles.candidateRadio}
                    checked={selectedTotalId === t.id}
                    onChange={() => setSelectedTotalId(t.id)}
                  />
                  <span className={styles.candidateDescription}>{t.label}</span>
                  {t.amountDollars !== null ? (
                    <span className={styles.candidateAmount}>{formatCurrency(t.amountDollars)}</span>
                  ) : (
                    <span className={styles.candidateUnreadableTag}>amount unreadable</span>
                  )}
                </label>
              ))
            )}
          </section>

          <section>
            <h2 className={styles.sectionHeading}>Line items</h2>
            <p className={styles.sectionSubtext}>
              Include the rows that belong in this estimate, and mark each one verified against the source image
              before confirming.
            </p>
            {lineItems.length === 0 ? (
              <p className={styles.emptyCandidatesNote}>No line items were read automatically.</p>
            ) : (
              lineItems.map((li) => {
                const isIncluded = included.has(li.id);
                const isVerified = verified.has(li.id);
                const rowClass =
                  li.amountDollars === null
                    ? styles.candidateRowUnreadable
                    : focusedBox?.pageIndex === li.pageIndex &&
                        focusedBox.x0 === li.bbox.x0 &&
                        focusedBox.y0 === li.bbox.y0
                      ? styles.candidateRowFocused
                      : styles.candidateRow;
                return (
                  <div key={li.id} className={rowClass} onMouseEnter={() => focusRow(li)}>
                    <input
                      type="checkbox"
                      aria-label={`Include ${li.description}`}
                      className={styles.candidateCheckbox}
                      checked={isIncluded}
                      disabled={li.amountDollars === null}
                      onChange={() => toggleIncluded(li.id)}
                    />
                    <span className={styles.candidateDescription}>{li.description}</span>
                    {li.amountDollars !== null ? (
                      <span className={styles.candidateAmount}>{formatCurrency(li.amountDollars)}</span>
                    ) : (
                      <span className={styles.candidateUnreadableTag}>amount unreadable</span>
                    )}
                    {isIncluded ? (
                      <label className={styles.verifyLabel}>
                        <input
                          type="checkbox"
                          aria-label={`Mark verified: ${li.description}`}
                          className={styles.candidateCheckbox}
                          checked={isVerified}
                          onChange={() => toggleVerified(li.id)}
                        />
                        Verified
                      </label>
                    ) : null}
                  </div>
                );
              })
            )}
          </section>

          <button type="button" className={styles.secondaryButton} onClick={() => setManualMode(true)}>
            Switch to manual entry instead
          </button>
        </>
      ) : (
        <section>
          <h2 className={styles.sectionHeading}>Manual entry</h2>
          <p className={styles.sectionSubtext}>
            Enter the total and, optionally, a line-item breakdown by hand. The document photo stays attached to
            this version either way.
          </p>
          <div className={styles.totalInputRow}>
            <span className={styles.dollarPrefix}>$</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              aria-label="Confirmed total"
              className={styles.totalInput}
              value={manualTotal}
              onChange={(e) => setManualTotal(e.target.value)}
            />
          </div>
          {manualLines.map((line, i) => (
            <div key={line.id} className={styles.manualLineItemRow}>
              <input
                type="text"
                aria-label={`Line item ${i + 1} description`}
                placeholder="Description"
                className={styles.manualDescriptionInput}
                value={line.description}
                onChange={(e) =>
                  setManualLines((prev) =>
                    prev.map((l) => (l.id === line.id ? { ...l, description: e.target.value } : l)),
                  )
                }
              />
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                aria-label={`Line item ${i + 1} amount`}
                placeholder="Amount"
                className={styles.manualAmountInput}
                value={line.amount}
                onChange={(e) =>
                  setManualLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, amount: e.target.value } : l)))
                }
              />
              <button
                type="button"
                className={styles.removeLineButton}
                aria-label={`Remove line item ${i + 1}`}
                onClick={() => setManualLines((prev) => prev.filter((l) => l.id !== line.id))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.addLineButton}
            onClick={() => setManualLines((prev) => [...prev, newManualLine()])}
          >
            + Add line item
          </button>
          {hasOcrCandidates ? (
            <button type="button" className={styles.secondaryButton} onClick={() => setManualMode(false)}>
              Back to automatic candidates
            </button>
          ) : null}
        </section>
      )}

      {reconciliation ? (
        <div className={reconciliation.reconciles ? styles.reconciliationOk : styles.reconciliationMismatch}>
          <p className={styles.reconciliationText}>
            {reconciliation.reconciles
              ? `Line items match the total (${formatCurrency(reconciliation.lineItemsTotalCents / 100)}).`
              : `Line items sum to ${formatCurrency(reconciliation.lineItemsTotalCents / 100)}, which does not match the selected total of ${formatCurrency(reconciliation.selectedTotalCents / 100)}.`}
          </p>
          {!reconciliation.reconciles ? (
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={mismatchAcknowledged}
                onChange={(e) => setMismatchAcknowledged(e.target.checked)}
              />
              <span className={styles.checkboxText}>
                I have reviewed this mismatch against the source document and confirm the total above is correct.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {sanity.exceedsBound === true && sanity.thresholdDollars !== null ? (
        <div className={styles.sanityPanel}>
          <p className={styles.sanityText}>
            This total exceeds 3× the structure&apos;s assessed improvement value ({formatCurrency(sanity.thresholdDollars)}
            ). Double-check this figure before confirming.
          </p>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={sanityAcknowledged}
              onChange={(e) => setSanityAcknowledged(e.target.checked)}
            />
            <span className={styles.checkboxText}>I have verified this figure is correct despite the bound.</span>
          </label>
        </div>
      ) : null}

      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={scopeReviewed}
          onChange={(e) => setScopeReviewed(e.target.checked)}
        />
        <span className={styles.checkboxText}>
          This estimate has been reviewed for disaster-related scope only — any unrelated repair or remodeling
          items have been excluded.
        </span>
      </label>

      <div className={styles.field}>
        <label htmlFor="estimate-notes" className={styles.verifyLabel}>
          Notes (optional)
        </label>
        <textarea
          id="estimate-notes"
          className={styles.notesTextarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the official should know about this estimate."
        />
      </div>

      {submitState === "error" ? (
        <div className={styles.errorPanel} role="alert">
          <p className={styles.errorText}>{errorMessage}</p>
        </div>
      ) : null}

      <button type="button" className={styles.primaryButton} disabled={!canConfirm} onClick={handleConfirm}>
        {submitState === "submitting" ? "Saving…" : "Confirm estimate"}
      </button>
    </div>
  );
}
