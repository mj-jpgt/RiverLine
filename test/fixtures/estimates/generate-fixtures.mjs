#!/usr/bin/env node
// Generates the synthetic contractor-estimate fixture images this module's
// tests use (test/unit/modules/a4 unit tests reference the OCR text these
// produce; test/e2e/a4-estimates.spec.ts uploads the PNGs themselves).
//
// Per task instructions: "generate 2-3 synthetic estimate images yourself
// at build-test time... via Playwright screenshot into
// test/fixtures/estimates/, committed, labeled in a README as synthetic."
// Every contractor name/address/line item below is obviously fake
// (TEST CONTRACTING FIXTURE LLC, 000 Fixture Way) — see README.md in this
// directory. NOT run automatically by any test; run by hand
// (`node test/fixtures/estimates/generate-fixtures.mjs`) whenever the
// fixture content needs to change, then the resulting PNGs are committed
// like any other fixture (AGENTS.md rule 6 — fixtures live only in
// test/fixtures/).
//
// Uses @playwright/test's bundled chromium (already a devDependency for
// e2e — no new dependency) to render plain HTML/CSS to a PNG screenshot,
// exactly the way a phone camera photo of a printed estimate would look:
// clean, high-contrast, standard fonts — "OCR accuracy on clean synthetic
// images should be high" (task instructions).
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLEAN_HTML = `
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; width: 900px; padding: 40px; background: #ffffff; color: #111111; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { font-size: 14px; color: #333; margin: 0 0 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 16px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ccc; }
  th { border-bottom: 2px solid #111; }
  td.amt, th.amt { text-align: right; }
  .totals td { font-weight: bold; border-top: 2px solid #111; border-bottom: none; }
  .grand td { font-size: 20px; }
  .meta { margin-top: 24px; font-size: 13px; color: #444; }
</style></head>
<body>
  <h1>TEST CONTRACTING FIXTURE LLC</h1>
  <p class="sub">000 Fixture Way, Testville, IN 00000 — SYNTHETIC DOCUMENT, NOT A REAL CONTRACTOR</p>
  <p class="sub">Repair Estimate — Prepared for: Practice Structure, 123 Practice Ln</p>
  <table>
    <thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead>
    <tbody>
      <tr><td>Roof covering replacement</td><td class="amt">$4,500.00</td></tr>
      <tr><td>Interior drywall and finish repair</td><td class="amt">$3,200.00</td></tr>
      <tr><td>Electrical system repair</td><td class="amt">$1,800.00</td></tr>
      <tr><td>Plumbing fixture replacement</td><td class="amt">$1,000.00</td></tr>
      <tr><td>Floor finish replacement</td><td class="amt">$2,000.00</td></tr>
      <tr class="totals"><td>Subtotal</td><td class="amt">$12,500.00</td></tr>
      <tr class="grand"><td>Total</td><td class="amt">$12,500.00</td></tr>
    </tbody>
  </table>
  <p class="meta">Fixture id: CLEAN-01 — reconciling (line items sum to the stated total exactly).</p>
</body></html>
`;

const MISMATCH_HTML = `
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; width: 900px; padding: 40px; background: #ffffff; color: #111111; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { font-size: 14px; color: #333; margin: 0 0 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 16px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ccc; }
  th { border-bottom: 2px solid #111; }
  td.amt, th.amt { text-align: right; }
  .totals td { font-weight: bold; border-top: 2px solid #111; border-bottom: none; }
  .grand td { font-size: 20px; }
  .meta { margin-top: 24px; font-size: 13px; color: #444; }
</style></head>
<body>
  <h1>TEST CONTRACTING FIXTURE LLC</h1>
  <p class="sub">000 Fixture Way, Testville, IN 00000 — SYNTHETIC DOCUMENT, NOT A REAL CONTRACTOR</p>
  <p class="sub">Repair Estimate — Prepared for: Practice Structure, 123 Practice Ln</p>
  <table>
    <thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead>
    <tbody>
      <tr><td>Foundation repair</td><td class="amt">$2,000.00</td></tr>
      <tr><td>Superstructure framing repair</td><td class="amt">$3,000.00</td></tr>
      <tr class="grand"><td>Total</td><td class="amt">$9,000.00</td></tr>
    </tbody>
  </table>
  <p class="meta">Fixture id: MISMATCH-01 — line items (2,000 + 3,000 = 5,000) intentionally do NOT sum to the stated total (9,000), for the reconciliation-mismatch test path.</p>
</body></html>
`;

const HIGH_VALUE_HTML = `
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, Helvetica, sans-serif; width: 900px; padding: 40px; background: #ffffff; color: #111111; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { font-size: 14px; color: #333; margin: 0 0 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 16px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #ccc; }
  th { border-bottom: 2px solid #111; }
  td.amt, th.amt { text-align: right; }
  .totals td { font-weight: bold; border-top: 2px solid #111; border-bottom: none; }
  .grand td { font-size: 20px; }
  .meta { margin-top: 24px; font-size: 13px; color: #444; }
</style></head>
<body>
  <h1>TEST CONTRACTING FIXTURE LLC</h1>
  <p class="sub">000 Fixture Way, Testville, IN 00000 — SYNTHETIC DOCUMENT, NOT A REAL CONTRACTOR</p>
  <p class="sub">Repair Estimate — Prepared for: Practice Structure, 123 Practice Ln</p>
  <table>
    <thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead>
    <tbody>
      <tr><td>Full structure rebuild</td><td class="amt">$500,000.00</td></tr>
      <tr class="grand"><td>Total</td><td class="amt">$500,000.00</td></tr>
    </tbody>
  </table>
  <p class="meta">Fixture id: HIGHVALUE-01 — total (500,000) intentionally exceeds 3x the seeded practice structure's improvement value (140,000 -> bound 420,000), for the sanity-bound test path.</p>
</body></html>
`;

const FIXTURES = [
  { name: "clean-reconciling.png", html: CLEAN_HTML },
  { name: "mismatch.png", html: MISMATCH_HTML },
  { name: "high-value.png", html: HIGH_VALUE_HTML },
];

const browser = await chromium.launch();
// deviceScaleFactor 2: renders at 2x pixel density (like a retina screenshot
// or a decent phone camera), which measurably improves OCR accuracy on
// small text — verified empirically in this task's own build session (the
// 1x render misread one line's amount; the 2x render did not, across
// repeated runs).
const page = await browser.newPage({ viewport: { width: 980, height: 700 }, deviceScaleFactor: 2 });

for (const fixture of FIXTURES) {
  await page.setContent(fixture.html);
  const outPath = path.join(__dirname, fixture.name);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`wrote ${outPath}`);
}

await browser.close();
