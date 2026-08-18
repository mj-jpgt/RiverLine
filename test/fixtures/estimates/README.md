# A4 estimate fixtures — synthetic, not real documents

All three PNGs in this directory are generated, not photographed or
downloaded (`generate-fixtures.mjs`, run by hand via
`node test/fixtures/estimates/generate-fixtures.mjs`). Every contractor
name, address, and dollar figure is fabricated and obviously so:
**"TEST CONTRACTING FIXTURE LLC"**, **"000 Fixture Way, Testville, IN
00000"**, plus an in-image line reading **"SYNTHETIC DOCUMENT, NOT A REAL
CONTRACTOR"**. No real contractor's name, letterhead, or pricing appears
anywhere in this repository (AGENTS.md rule 6; task instructions:
"NO real contractor documents").

| File | Purpose |
|---|---|
| `clean-reconciling.png` | Line items sum exactly to the stated total ($12,500.00) — the "everything reconciles" happy path. Also THE spec §8.6 currency-artifact case in miniature: the printed total is `$12,500.00`. |
| `mismatch.png` | Line items ($2,000 + $3,000 = $5,000) deliberately do **not** sum to the stated total ($9,000) — exercises the reconciliation-mismatch flag (spec §8.1). |
| `high-value.png` | A single $500,000.00 line item/total, deliberately >3x the seeded practice structure's improvement value ($140,000 → bound $420,000) — exercises the sanity-bound hard-flag (spec §8.6). |

Regenerating: edit `generate-fixtures.mjs`'s HTML templates and re-run the
script. Committed as PNGs (not regenerated at test time) so OCR-accuracy
runs and the e2e spec have a stable, reviewable input — the same reasoning
`test/fixtures/photos/sample-exterior.jpg` already establishes for this
codebase's other committed image fixture.
