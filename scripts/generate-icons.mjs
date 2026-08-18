#!/usr/bin/env node
// pnpm exec node scripts/generate-icons.mjs — renders the RiverLine SDD app
// mark to real PNGs via a real Chromium screenshot (Playwright, already a
// pinned devDependency — no new dependency added), writes them to
// public/icons/, and prints the exact <link> tags to register in
// app/layout.tsx (that file is owned by a different concurrent workstream
// this wave — see docs/journal/2026-08-17-w4-deploy.md for the exact lines
// to add there).
//
// Design: institutional, plain, per docs/design/direction.md — "not a
// SaaS dashboard... no illustration, no mascots." A flat token-colored
// square with "RL" in the interface typeface. No gradients, no drop
// shadows, no rounded-corner clipping baked into the PNG itself (the OS/
// browser chrome applies its own corner rounding — baking one in ourselves
// would double up or clash with maskable icon safe-zone requirements).
//
// Colors and font are read directly from docs/design/tokens.css — the only
// source of color/type in this codebase (AGENTS.md: "Raw hex... fail
// lint" for app code; this script is generation tooling, not app code, but
// still must not invent a color, so the values are copied from the cited
// token file, not made up):
//   --color-action:         #005ea2  (USWDS blue-60v — primary interactive)
//   --color-surface-raised: #ffffff  (USWDS "white")
//   --font-ui: "Source Sans Pro Web", "Helvetica Neue", "Helvetica",
//              "Roboto", "Arial", sans-serif
// See docs/design/tokens.css for citations (USWDS v3.13.0, retrieved
// 2026-08-17) — copied here, not re-derived, so this file and tokens.css
// can never silently drift without a diff showing both.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "icons");

// Copied from docs/design/tokens.css — see header comment above.
const COLOR_ACTION = "#005ea2";
const COLOR_SURFACE_RAISED = "#ffffff";
const FONT_UI =
  '"Source Sans Pro Web", "Helvetica Neue", "Helvetica", "Roboto", "Arial", sans-serif';

/**
 * @param {number} size full canvas size in px
 * @param {number} markScale 0..1, how much of the canvas the "RL" mark's
 *   bounding area occupies — smaller for maskable (safe-zone) and
 *   apple-touch (iOS applies its own rounding + padding conventions) icons.
 */
function markupFor(size, markScale) {
  const fontSize = Math.round(size * markScale * 0.58);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${size}px; height: ${size}px;
    background: ${COLOR_ACTION};
    display: flex; align-items: center; justify-content: center;
  }
  span {
    font-family: ${FONT_UI};
    font-weight: 700;
    font-size: ${fontSize}px;
    line-height: 1;
    color: ${COLOR_SURFACE_RAISED};
    letter-spacing: -0.02em;
    user-select: none;
  }
</style></head>
<body><span>RL</span></body></html>`;
}

/** @type {Array<{ name: string, size: number, markScale: number, purpose?: string }>} */
const ICONS = [
  { name: "icon-192.png", size: 192, markScale: 0.62 },
  { name: "icon-512.png", size: 512, markScale: 0.62 },
  // Maskable: OS may crop to a circle/squircle/rounded-square. Spec's safe
  // zone is the inner 80% (40% radius from center) — markScale kept well
  // inside that with the flat background bleeding edge-to-edge (no
  // transparency, no padding baked in beyond what keeps "RL" inside the
  // safe zone).
  { name: "icon-maskable-512.png", size: 512, markScale: 0.42, purpose: "maskable" },
  // Apple touch icon: Apple's own guidance is a full-bleed square (no
  // transparency, no pre-rounded corners — iOS applies its own mask), 180x180
  // is the current recommended size for modern devices.
  { name: "apple-touch-icon.png", size: 180, markScale: 0.62 },
];

async function main() {
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const written = [];
    for (const icon of ICONS) {
      const page = await browser.newPage({
        viewport: { width: icon.size, height: icon.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(markupFor(icon.size, icon.markScale));
      // Wait for the (system/fallback) font to settle before screenshotting.
      await page.evaluate(() => document.fonts.ready);
      const buffer = await page.screenshot({ type: "png" });
      await page.close();

      const outPath = path.join(outDir, icon.name);
      writeFileSync(outPath, buffer);
      written.push({ ...icon, outPath });
      console.log(`OK: wrote ${outPath} (${icon.size}x${icon.size}${icon.purpose ? `, purpose=${icon.purpose}` : ""})`);
    }

    console.log("\n--- manifest.webmanifest icons entry (already applied to public/manifest.webmanifest) ---");
    console.log(
      JSON.stringify(
        written
          .filter((w) => w.name !== "apple-touch-icon.png")
          .map((w) => ({
            src: `/icons/${w.name}`,
            sizes: `${w.size}x${w.size}`,
            type: "image/png",
            ...(w.purpose ? { purpose: w.purpose } : {}),
          })),
        null,
        2,
      ),
    );

    console.log("\n--- app/layout.tsx <head> line to add (app/layout.tsx is owned by another workstream this wave — not edited here) ---");
    console.log('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("BLOCKER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
