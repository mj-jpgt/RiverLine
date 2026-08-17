"use client";

import { useState } from "react";
import styles from "../page.module.css";

// CSV export button — components.md's dashboard inventory: "default, hover,
// active/pressed, loading (generating), success/error." A plain
// `<a download>` link can't show a loading state (the browser gives no
// signal while the server is generating), so this fetches the export route
// itself, then triggers the browser's save dialog from the resulting blob —
// same end result as a direct link, but with a real loading/error state the
// user can see. No new dependency: fetch + Blob + a synthetic anchor click
// are all platform APIs.
function useDownload(url: string, fallbackFilename: string) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function download() {
    setState("loading");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? fallbackFilename;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return { state, download };
}

export function ExportCsvButton({ queryString }: { queryString: string }) {
  const url = `/dashboard/export/csv${queryString ? `?${queryString}` : ""}`;
  const { state, download } = useDownload(url, "caseload-export.csv");

  return (
    <div className={styles.exportControl}>
      <button
        type="button"
        className={styles.exportButton}
        onClick={download}
        disabled={state === "loading"}
        aria-describedby={state === "error" ? "export-csv-error" : undefined}
      >
        {state === "loading" ? "Preparing export…" : "Export CSV"}
      </button>
      {state === "error" ? (
        <p id="export-csv-error" className={styles.exportError} role="alert">
          Could not generate the export. Try again.
        </p>
      ) : null}
    </div>
  );
}

export function FullExportButton() {
  const { state, download } = useDownload("/dashboard/export/full", "records-request-export.zip");

  return (
    <div className={styles.exportControl}>
      <button
        type="button"
        className={styles.exportButtonOutline}
        onClick={download}
        disabled={state === "loading"}
        aria-describedby={state === "error" ? "export-full-error" : undefined}
      >
        {state === "loading" ? "Preparing bundle…" : "Full export (records request)"}
      </button>
      {state === "error" ? (
        <p id="export-full-error" className={styles.exportError} role="alert">
          Could not generate the full export. Try again.
        </p>
      ) : null}
    </div>
  );
}
