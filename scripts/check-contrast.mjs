#!/usr/bin/env node
/**
 * check-contrast.mjs
 *
 * Zero-dependency WCAG contrast checker for docs/design/tokens.css.
 *
 * Parses the `:root { --token: #hex; ... }` declarations out of tokens.css,
 * then computes the WCAG 2.x contrast ratio (relative-luminance formula,
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance) for a fixed list of
 * text-on-surface pairings that matter for this product:
 *
 *   - body text and muted text against both surfaces
 *   - every status color (used as text/label color, never fill-only) against
 *     both surfaces
 *   - the danger color against both surfaces
 *   - white button-label text against the three action fill colors
 *
 * Thresholds:
 *   - Normal text:            4.5:1  (WCAG AA, 1.4.3)
 *   - Large text (>=24px or
 *     >=19px bold):            3:1   (WCAG AA, 1.4.3 large-text exception)
 *
 * All of RiverLine's status/text pairings above are treated as NORMAL text
 * (4.5:1) because status labels and body copy are not guaranteed to render
 * at the large-text size threshold. Where a pairing is explicitly a large
 * heading/display use, it is called out below and checked at 3:1 instead.
 *
 * Exit code is nonzero if any pairing fails its threshold.
 *
 * Usage:
 *   node scripts/check-contrast.mjs [path/to/tokens.css]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const AA_NORMAL_TEXT = 4.5;
const AA_LARGE_TEXT = 3.0;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "docs", "design", "tokens.css");

function parseTokens(css) {
  const tokens = {};
  // Match `--token-name: <value>;` where value contains a #hex color as the
  // first token on the line (ignores non-color tokens like spacing/radius).
  const re = /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    tokens[m[1]] = m[2].toLowerCase();
  }
  return tokens;
}

function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance([r, g, b]) {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

function main() {
  let css;
  try {
    css = readFileSync(tokensPath, "utf8");
  } catch (err) {
    console.error(`Could not read tokens file at ${tokensPath}: ${err.message}`);
    process.exit(2);
  }

  const tokens = parseTokens(css);

  const required = [
    "color-surface",
    "color-surface-raised",
    "color-text",
    "color-text-muted",
    "color-action",
    "color-action-hover",
    "color-action-pressed",
    "color-status-not-sd",
    "color-status-borderline",
    "color-status-sd",
    "color-status-draft",
    "color-danger",
  ];
  const missing = required.filter((t) => !tokens[t]);
  if (missing.length) {
    console.error(
      `tokens.css is missing required color tokens: ${missing.join(", ")}`
    );
    process.exit(2);
  }

  const surfaces = [
    ["color-surface", tokens["color-surface"]],
    ["color-surface-raised", tokens["color-surface-raised"]],
  ];

  const textColors = [
    "color-text",
    "color-text-muted",
    "color-status-not-sd",
    "color-status-borderline",
    "color-status-sd",
    "color-status-draft",
    "color-danger",
  ];

  /** @type {{pair: string, ratio: number, threshold: number, pass: boolean}[]} */
  const results = [];

  // Text/status colors against both surfaces — normal-text threshold.
  for (const textToken of textColors) {
    for (const [surfaceToken, surfaceHex] of surfaces) {
      const ratio = contrastRatio(tokens[textToken], surfaceHex);
      results.push({
        pair: `${textToken} on ${surfaceToken}`,
        ratio,
        threshold: AA_NORMAL_TEXT,
        pass: ratio >= AA_NORMAL_TEXT,
      });
    }
  }

  // White button-label text on the three action fills — normal-text
  // threshold (button labels are not guaranteed large text).
  const actionFills = ["color-action", "color-action-hover", "color-action-pressed"];
  for (const fillToken of actionFills) {
    const ratio = contrastRatio("#ffffff", tokens[fillToken]);
    results.push({
      pair: `#ffffff (button label) on ${fillToken}`,
      ratio,
      threshold: AA_NORMAL_TEXT,
      pass: ratio >= AA_NORMAL_TEXT,
    });
  }

  // Report
  const width = Math.max(...results.map((r) => r.pair.length)) + 2;
  console.log("WCAG contrast check — docs/design/tokens.css\n");
  let anyFail = false;
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    if (!r.pass) anyFail = true;
    console.log(
      `${status}  ${r.pair.padEnd(width)} ${r.ratio.toFixed(2)}:1  (>= ${r.threshold}:1 required)`
    );
  }

  console.log("");
  if (anyFail) {
    console.error("One or more pairings fall below the required WCAG AA threshold.");
    process.exit(1);
  } else {
    console.log("All pairings pass WCAG AA.");
    process.exit(0);
  }
}

main();
