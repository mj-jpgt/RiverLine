"use client";

import { useId, useState } from "react";
import { processPhoto } from "@/core/capture";
import styles from "../capture.module.css";

interface PhotoCaptureProps {
  label: string;
  onCaptured: (processed: { blob: Blob; width: number; height: number; sha256: string }) => void;
  disabled?: boolean;
}

// input type=file accept=image/* capture=environment — per build spec §11.8
// and docs/adr/0002-offline-and-pwa.md (camera permission is re-requested
// every mount on iOS standalone PWAs; a plain file input sidesteps needing
// a persistent getUserMedia grant at all). setInputFiles() in Playwright
// targets this exact control without needing real camera hardware.
export function PhotoCapture({ label, onCaptured, disabled }: PhotoCaptureProps) {
  const inputId = useId();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file (retake)
    if (!file) return;
    setError(null);
    setProcessing(true);
    try {
      const processed = await processPhoto(file);
      onCaptured(processed);
    } catch {
      setError("Could not process that photo. Try again.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className={styles.photoCaptureButton}>
        {processing ? "Processing photo…" : label}
      </label>
      <input
        id={inputId}
        className={styles.hiddenFileInput}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled || processing}
        onChange={handleChange}
      />
      {error ? (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
