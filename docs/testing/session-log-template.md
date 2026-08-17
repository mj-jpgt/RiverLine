# Live Test Session Log Template

Copy this block into a new entry under "Sessions" below for every live-test
run (`docs/testing/live-test-plan.md`). One entry per session. Do not edit
past entries — append only, same discipline as `docs/journal/`.

```
## Session: <YYYY-MM-DD> — <short label, e.g. "T-C5 pre-merge run">

- **Tester(s):** <name/role, e.g. "assessor: MJ; official: <colleague>">
- **Device(s):** <model, e.g. "iPhone 13, standalone PWA (home-screen install)">
- **iOS version:** <e.g. "18.1.1">
- **Browser/PWA mode:** <Safari tab | standalone home-screen>
- **Jurisdiction/data used:** <real jurisdiction name, or "Demo City / 123 Practice Ln">
- **Build/commit under test:** <git short SHA or deploy tag>

### Procedures run

| Procedure ID | Result (PASS/FAIL/BLOCKED/NO COVERAGE) | Measured value (if applicable) | Notes |
|---|---|---|---|
| LT-1 | | elapsed: __ min, airplane window: __ min | |
| LT-2 | | | |
| LT-2b | | | |
| LT-3 | | | |
| LT-4 | | | |
| LT-4b | | | |
| LT-5 | | | |
| LT-5b | | | |
| LT-6 | | | |
| OT-1 | | | |
| OT-2 | | | |
| OT-3 | | | |
| OT-4 | | | |
| OT-5 | | | |
| FC-1 | | measured px: __ | |
| FC-2 | | measured ratio: __:1 | |
| FC-3 | | | |
| FC-4 | | | |
| FC-5 | | | |
| FC-6 | | | |
| FC-7 | | elapsed: __ min | |
| DI-1 | | | |
| DI-2 | | | |
| DI-3 | | | |
| DI-4 | | | |

(Delete rows for procedures not applicable to this session's scope — e.g., a
capture-flow-only session may only run LT-1, OT-1..OT-5, FC-1..FC-7.)

### Defects found

| # | Procedure | Severity (blocker/major/minor) | Description | Filed as |
|---|---|---|---|---|
| 1 | | | | |

### Evidence

List file paths / screenshot names / DB query outputs saved for this
session (do not paste secrets or raw PII — addresses and photos are fine
per build spec §7.3, PII like resident phone numbers is never collected in
the first place per AGENTS.md rule 8).

### Summary

<2-3 sentences: overall pass/fail, whether this session clears the module
for merge/pilot, and the single most important open issue.>
```

---

## Sessions

(Append new session entries above this line, most recent last, using the
template above.)
