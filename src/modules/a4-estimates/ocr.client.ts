"use client";

// Client-side OCR (docs/adr/0007-ocr-estimate-intake.md). tesseract.js is
// imported dynamically, only when a document is actually being processed,
// so it never adds weight to any page's initial bundle. This file is the
// ONLY place in the module that imports tesseract.js; parser.ts (pure) does
// the actual line-item/total extraction from the plain OcrLine[] shape this
// file produces, so the parsing logic itself is unit-testable with zero
// browser/WASM dependency.
import { parseLineItemsAndTotals } from "./parser";
import type { ExtractedJson, ExtractedPage, OcrLine } from "./types";

const TESSERACT_ENGINE_VERSION = "7.0.0"; // package.json — pinned, verified per ADR 0007, not recalled.

export interface OcrProgress {
  status: string;
  progress: number;
  pageIndex: number;
  pageCount: number;
}

/** Runs OCR on one or more page images (in order) and returns the combined
 * extraction. A fresh worker is created and terminated per call — this
 * module only ever OCRs one document at a time (no scheduler/queueing
 * needed at this scale, per AGENTS.md rule 6 "over-engineering"). */
export async function runOcrOnPages(
  pageBlobs: Blob[],
  onProgress?: (p: OcrProgress) => void,
): Promise<ExtractedJson> {
  const { createWorker } = await import("tesseract.js");
  // Declared BEFORE createWorker(), not after: the `logger` callback below
  // can fire asynchronously while `await createWorker(...)` is still
  // pending (verified — caught a real `ReferenceError: Cannot access
  // 'currentPageIndex' before initialization` in this task's own browser
  // testing when this was declared below the call instead).
  let currentPageIndex = 0;
  const worker = await createWorker("eng", undefined, {
    // Self-hosted, same-origin worker/core/lang assets (public/tesseract-assets/,
    // committed — see that directory's README), NOT tesseract.js's CDN
    // defaults. Required by this app's CSP (middleware.ts, W3's work,
    // 2026-08-17): `worker-src 'self'` rejects both a cross-origin worker
    // script AND the blob: URL tesseract.js creates by default to sideload
    // a CDN script (spawnWorker.js wraps workerPath in `importScripts(...)`
    // inside a Blob when `workerBlobURL` is true, the default) —
    // `workerBlobURL: false` makes it `new Worker(workerPath)` directly
    // instead (verified by reading
    // node_modules/tesseract.js/src/worker/browser/spawnWorker.js), which
    // passes `worker-src 'self'` once `workerPath` is same-origin.
    // `connect-src 'self'` similarly blocks the langPath fetch to
    // tesseract.js's default CDN, so that's self-hosted too. `corePath`
    // points at ONE specific `.js` file (not a directory) — per
    // node_modules/tesseract.js/src/worker-script/browser/getCore.js,
    // a corePath ending in `.js` skips SIMD/relaxed-SIMD auto-detection
    // entirely and loads exactly that file; only the SIMD+LSTM variant is
    // self-hosted (not the non-SIMD fallback) — documented tradeoff in
    // docs/adr/0007, open item for a follow-up if a non-SIMD-capable
    // browser needs support.
    workerPath: "/tesseract-assets/worker.min.js",
    workerBlobURL: false,
    corePath: "/tesseract-assets/tesseract-core-simd-lstm.wasm.js",
    langPath: "/tesseract-assets",
    logger: (m) => {
      if (onProgress) {
        onProgress({ status: m.status, progress: m.progress, pageIndex: currentPageIndex, pageCount: pageBlobs.length });
      }
    },
  });

  const pages: ExtractedPage[] = [];

  try {
    for (let i = 0; i < pageBlobs.length; i++) {
      currentPageIndex = i;
      const blob = pageBlobs[i];
      if (!blob) continue;
      const { width, height } = await blobDimensions(blob);
      const result = await worker.recognize(blob, {}, { text: true, blocks: true });
      const lines = flattenLines(result.data.blocks ?? []);
      pages.push({
        pageIndex: i,
        imageWidthPx: width,
        imageHeightPx: height,
        fullText: result.data.text,
        lines,
      });
    }
  } finally {
    await worker.terminate();
  }

  const lineItems = [];
  const candidateTotals = [];
  for (const page of pages) {
    const parsed = parseLineItemsAndTotals(page.lines, page.pageIndex);
    lineItems.push(...parsed.lineItems);
    candidateTotals.push(...parsed.candidateTotals);
  }

  return {
    engine: "tesseract.js",
    engineVersion: TESSERACT_ENGINE_VERSION,
    extractedAtIso: new Date().toISOString(),
    pages,
    lineItems,
    candidateTotals,
  };
}

// Tesseract's typed `Block` shape (see node_modules/tesseract.js/src/index.d.ts
// Block/Paragraph/Line) nests lines two levels deep and only exists when
// `{ blocks: true }` is passed as the recognize() output option (the
// default output omits it entirely to save response size — verified by
// reading node_modules/tesseract.js/src/worker-script/constants/defaultOutput.js
// directly, not assumed).
interface TesseractBboxLike {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TesseractLineLike {
  text: string;
  confidence: number;
  bbox: TesseractBboxLike;
}
interface TesseractParagraphLike {
  lines: TesseractLineLike[];
}
interface TesseractBlockLike {
  paragraphs: TesseractParagraphLike[];
}

function flattenLines(blocks: TesseractBlockLike[]): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        if (line.text.trim().length === 0) continue;
        lines.push({
          text: line.text,
          bbox: { x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1 },
          confidence: line.confidence,
        });
      }
    }
  }
  return lines;
}

function blobDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return createImageBitmap(blob).then((bitmap) => {
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dims;
  });
}
