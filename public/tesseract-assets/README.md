# Self-hosted tesseract.js runtime assets

Committed, third-party binaries — NOT authored by this project. Vendored
here (rather than left on tesseract.js's default CDN) because this app's
CSP (`middleware.ts`, `worker-src 'self'` + `connect-src 'self'`, see
`docs/security-review.md`) blocks both a cross-origin Worker script and a
cross-origin `fetch()` for the language data. See
`docs/adr/0007-ocr-estimate-intake.md` for the full reasoning and
`src/modules/a4-estimates/ocr.client.ts` for how these paths are wired in.

| File | Source | Version |
|---|---|---|
| `worker.min.js` | `tesseract.js` npm package, `dist/worker.min.js` | 7.0.0 (pinned in `package.json`) |
| `tesseract-core-simd-lstm.wasm.js` / `.wasm` | `tesseract.js-core` npm package (tesseract.js's own transitive dependency) | 7.0.0 |
| `eng.traineddata.gz` | `@tesseract.js-data/eng` — fetched once from `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` (tesseract.js's own documented default language-data source, read from `node_modules/tesseract.js/src/worker-script/index.js`) | 4.0.0_best_int (LSTM-optimized) |

Licensing: `tesseract.js`/`tesseract.js-core` are Apache-2.0
(`node_modules/tesseract.js/LICENSE.md`); the `eng.traineddata` model is
the standard Tesseract OCR English trained-data file (Apache-2.0, per the
Tesseract project). No modification was made to any of these files —
copied byte-for-byte from the installed npm packages / the package's own
documented CDN source.

**Only the SIMD+LSTM core variant is hosted** (not the non-SIMD fallback
tesseract.js's default CDN path would auto-select for an older browser) —
a documented, time-boxed tradeoff; see the ADR's "Consequences" section.

**Regenerating**: if `tesseract.js`/`tesseract.js-core` is ever upgraded,
re-copy from the new `node_modules/tesseract.js/dist/worker.min.js` and
`node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm{,.js}`, and
re-verify `TESSERACT_ENGINE_VERSION` in `ocr.client.ts` still matches
`package.json`.
