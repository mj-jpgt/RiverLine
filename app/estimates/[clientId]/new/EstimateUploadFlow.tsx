"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Imported from the specific client-only submodules, NOT the module's
// barrel index.ts — the barrel also re-exports src/modules/a4-estimates/
// actions.ts + queries.ts, which import "pg" (via @/shared/db) and cannot
// resolve in a client bundle (verified: `next build` failed with "Module
// not found: fs/dns/net/tls" the first time this imported through the
// barrel). eslint-plugin-boundaries permits this — the "modules" policy
// for `app` has no fileInternalPath restriction, unlike the "core" policy's
// index.ts-only rule (docs/adr/0003-module-boundary-enforcement.md).
import { processEstimatePage } from "@/modules/a4-estimates/image.client";
import { runOcrOnPages } from "@/modules/a4-estimates/ocr.client";
import type { OcrProgress } from "@/modules/a4-estimates/ocr.client";
import type { EstimatePageUpload, ExtractedJson } from "@/modules/a4-estimates/types";
import styles from "./new.module.css";

type Stage = "select" | "processing" | "uploading" | "error";

interface SelectedPage {
  file: File;
  previewUrl: string;
}

// spec §8 mitigation 3 ("Multi-page and revision confusion... one estimate
// = one document record with explicit version"): every file selected here
// becomes one PAGE of a single estimate document/version — never a
// separate estimate record per file. spec §8 mitigation 4 ("Field
// conditions... wet, wrinkled, low-light, glare-shot documents") is
// addressed by the existing src/core/capture/photo.ts downscale pipeline
// this reuses (via processEstimatePage) plus the "Skip automatic text
// reading" fallback below, which is always available — OCR failing or
// reading garbage never blocks getting the document on file.
export function EstimateUploadFlow({ clientId }: { clientId: string }) {
  const router = useRouter();
  const inputId = useId();
  const [pages, setPages] = useState<SelectedPage[]>([]);
  const [stage, setStage] = useState<Stage>("select");
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilesChosen(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const added = Array.from(fileList).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setPages((prev) => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePage(index: number) {
    setPages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  async function uploadAndAdvance(uploads: EstimatePageUpload[], extracted: ExtractedJson | null) {
    setStage("uploading");
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(clientId)}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: uploads, extracted }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Upload failed. Try again.");
        setStage("error");
        return;
      }
      const body = (await res.json()) as { estimateId: string };
      router.push(`/estimates/${encodeURIComponent(clientId)}/confirm/${body.estimateId}`);
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStage("error");
    }
  }

  async function handleReadAndContinue() {
    if (pages.length === 0) return;
    setStage("processing");
    setErrorMessage("");
    try {
      const processed = await Promise.all(pages.map((p) => processEstimatePage(p.file)));
      const uploads = processed.map((p) => p.upload);
      let extracted: ExtractedJson | null = null;
      try {
        // OCR runs against the ORIGINAL selected files, not the
        // downscaled/re-JPEG-compressed upload blobs — verified in this
        // task's own build session that recompression measurably degrades
        // OCR accuracy on some lines even at high source resolution.
        // extracted.pages[i].imageWidthPx/imageHeightPx therefore records
        // the ORIGINAL file's pixel dimensions, not the uploaded copy's —
        // the confirmation screen's SVG highlight overlay uses an
        // aspect-ratio-preserving viewBox
        // (app/estimates/[clientId]/confirm/[estimateId]/ConfirmEstimateForm.tsx),
        // so bbox coordinates still land correctly on the smaller
        // displayed/uploaded image regardless of the resolution mismatch —
        // downscaling never changes aspect ratio (src/core/capture/photo.ts's
        // processPhoto scales both dimensions by the same factor).
        extracted = await runOcrOnPages(
          pages.map((p) => p.file),
          setProgress,
        );
      } catch {
        // OCR failing is never fatal — spec §8 closing paragraph: manual
        // entry with the photo attached is always available. Upload
        // proceeds with extracted = null; the confirm screen falls back to
        // its manual-entry path automatically (no OCR data to show).
        extracted = null;
      }
      await uploadAndAdvance(uploads, extracted);
    } catch {
      setErrorMessage("Could not process that document. Try a clearer photo, or a different file.");
      setStage("error");
    }
  }

  async function handleSkipOcr() {
    if (pages.length === 0) return;
    setStage("processing");
    setErrorMessage("");
    try {
      const processed = await Promise.all(pages.map((p) => processEstimatePage(p.file)));
      await uploadAndAdvance(processed.map((p) => p.upload), null);
    } catch {
      setErrorMessage("Could not process that document. Try a clearer photo, or a different file.");
      setStage("error");
    }
  }

  const busy = stage === "processing" || stage === "uploading";

  return (
    <div>
      <div className={styles.uploadArea}>
        <label htmlFor={inputId} className={styles.fileButton}>
          {pages.length === 0 ? "Choose photo or file" : "Add another page"}
        </label>
        <input
          id={inputId}
          ref={fileInputRef}
          className={styles.hiddenFileInput}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          disabled={busy}
          onChange={(e) => handleFilesChosen(e.target.files)}
        />
        <p className={styles.uploadHint}>
          One or more photos of the same estimate document. Add a page for each additional page of a multi-page
          estimate.
        </p>
      </div>

      {pages.length > 0 ? (
        <div className={styles.selectedFilesRow}>
          {pages.map((p, i) => (
            <div key={p.previewUrl} className={styles.selectedThumbWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt={`Selected page ${i + 1}`} className={styles.selectedThumb} />
              <button
                type="button"
                className={styles.removeThumbButton}
                aria-label={`Remove page ${i + 1}`}
                disabled={busy}
                onClick={() => removePage(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {pages.length > 0 && stage === "select" ? (
        <>
          <button type="button" className={styles.primaryButton} onClick={handleReadAndContinue}>
            Read text automatically and continue
          </button>
          <button type="button" className={styles.secondaryButton} onClick={handleSkipOcr}>
            Skip automatic text reading. Enter values by hand
          </button>
        </>
      ) : null}

      {stage === "processing" ? (
        <div className={styles.progressPanel} role="status" aria-live="polite">
          <p className={styles.progressText}>
            {progress
              ? `Reading page ${progress.pageIndex + 1} of ${progress.pageCount}: ${progress.status}…`
              : "Preparing the document…"}
          </p>
          <progress className={styles.progressBar} value={progress?.progress ?? 0} max={1} />
          <p className={styles.progressPercent}>{Math.round((progress?.progress ?? 0) * 100)}%</p>
        </div>
      ) : null}

      {stage === "uploading" ? (
        <div className={styles.progressPanel} role="status" aria-live="polite">
          <p className={styles.progressText}>Uploading document…</p>
        </div>
      ) : null}

      {stage === "error" ? (
        <div className={styles.errorPanel} role="alert">
          <p className={styles.errorText}>{errorMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
