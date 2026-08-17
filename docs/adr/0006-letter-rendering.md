# 0006 — Letter rendering: print-CSS HTML, not server-side PDF

Status: Accepted
Date: 2026-08-17

## Context

T-A1 needs to produce a determination letter that a municipal official can
hand to a homeowner or mail: print-first, black on white, no background
fills (docs/design/direction.md → "Print"). Two realistic options, per the
task brief:

**(a) Print-CSS HTML + browser print-to-PDF.** Render the letter as a
self-contained HTML document with its own embedded `<style>` (no
dependency on the app shell or `tokens.css` at runtime — the archived copy
must remain byte-identical years later, independent of any future app
redesign). The official uses the browser's native "Print" dialog and saves
as PDF, or prints directly to a physical printer. Zero new dependencies.

**(b) Server-side PDF via Playwright chromium.** `@playwright/test`'s
bundled chromium is already an installed devDependency (used for e2e).
Launch a headless page, `page.setContent(html)`, `page.pdf()`, store the
resulting PDF bytes. Produces a real, byte-for-byte PDF file.

## Decision

**Option (a).** Reasons, in order:

1. **Zero new production dependency.** `@playwright/test` is a
   devDependency (test tooling), not shipped in the production bundle or
   the production `node_modules` install (`pnpm install --prod` would not
   include it). Using it to generate PDFs at request time in a Next.js
   route handler means promoting a devDependency into the production
   runtime path — that's a real dependency change requiring its own ADR
   and a human decision (AGENTS.md rule 3), and this task's scope is
   letters, not a build-tooling change. It would also mean shipping a full
   Chromium binary inside whatever deploys this app (Playwright's chromium
   download is ~150-300MB), which is a serious, undocumented production
   deployment cost this task should not silently introduce.
2. **Print quality is genuinely good enough.** A modern browser's
   print-to-PDF (Chrome/Edge "Save as PDF", or a real printer) renders CSS
   `@media print` rules correctly, including the exact `black`-on-`white`,
   no-background-fill requirement direction.md asks for. There is no
   rendering-fidelity gap that justifies the dependency cost above for an
   MVP.
3. **The official already does this workflow today** for every other
   paper document their office produces — "open the file, hit print" is
   the expected, unsurprising interaction for someone standing at a
   municipal building department, not a regression from a paper process.
4. **Honesty in the schema/UI is easier to get right with (a).** Since the
   MVP produces HTML, not PDF bytes, and `schema/core.sql`'s `letters`
   table names the column `pdf_storage_key` (frozen, cannot be renamed),
   there is a real risk of UI copy implying "PDF" when the stored artifact
   is HTML. Documenting this explicitly here and never using the word
   "PDF" in this module's UI copy (it says "Print / Save as PDF" as an
   action label describing what the *browser* does, never "Download PDF"
   as if the server produced one) keeps the app honest about what it
   actually stores.

## Consequences

- **`letters.pdf_storage_key` stores an HTML file, not a PDF**, in this
  MVP. The archived copy is the exact rendered HTML at issue time
  (`src/modules/a1-letters/pure.ts`'s `renderLetterHtml(facts, { issued:
  true })`), written to `uploads/letters/<jurisdictionId>/<letterId>.html`
  and served back byte-for-byte by `app/letters/[clientId]/print/route.ts`.
  This is a deliberate, documented naming mismatch with the frozen schema
  column — never presented to a user as a PDF file; the UI's only
  PDF-adjacent copy is the "Print / Save as PDF" button, which describes
  the browser's own print dialog, not a server-generated file.
- **Upgrade path exists and is cheap.** If a future task needs a real
  server-generated PDF (e.g. for an automated mail-merge/bulk-mailing
  pipeline that can't rely on a human clicking "Print"), the same
  `renderLetterHtml()` output is already exactly what `page.setContent()` +
  `page.pdf()` would consume — the rendering logic does not need to change,
  only the persistence step. That upgrade needs its own ADR (promoting
  Playwright, or another PDF library, to a production dependency) and a
  human decision per AGENTS.md rule 3; it is out of scope here.
- The rendered HTML is fully self-contained (inline `<style>`, no external
  CSS/JS/font requests) specifically so it never depends on `tokens.css`
  or the app shell staying unchanged — an issued letter from today must
  print identically if reopened after a future redesign.
- Print correctness (`black`/`white`, no background fills) is verified in
  `test/e2e/a1-letters.spec.ts` via `page.emulateMedia({ media: "print" })`
  and computed-style assertions against the rendered document.

## Sources

- Playwright's chromium as a devDependency: `package.json`
  (`"@playwright/test": "1.62.1"` under `devDependencies`, not
  `dependencies`) — read directly, not from memory.
- `schema/core.sql` line defining `letters.pdf_storage_key text not null`
  — read directly; frozen, cannot be renamed to reflect the MVP's actual
  HTML storage.
