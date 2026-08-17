# Human-only blockers

Things no agent can resolve. Everything else has been gathered — see
`docs/data-contracts/` and `docs/adr/`. Updated 2026-08-17.

---

## B1 — Select a cost-estimating guide (blocks M3, the 50%-rule engine)

**Why it is blocked:** FEMA P-784 contains no dollar unit costs. Verified twice:
the manual states base cost per square foot must come from an externally
licensed guide, and static inspection of the SDE 3.0 desktop tool found zero
populated dollar figures. This is a procurement decision, not a research task.

**Options and their verified risks:** `docs/adr/0005-cost-estimating-guide-options.md`

Two risks are already documented and roughly equal in severity:
- Marshall & Swift / SwiftEstimator: licensing may forbid embedding the data in
  software, which is a direct problem for `cost_tables.json_payload`.
- ICC Building Valuation Data: ICC's own document states the BVD "is not
  intended to apply to alterations or repairs to existing buildings" — which is
  exactly this project's use case.

**Recommended next action:** ask the Noblesville / Hamilton County floodplain
administrator what guide they already use for SI/SD determinations today. They
almost certainly have an answer, and adopting theirs removes both the
procurement cost and the "whose numbers are these" objection at appeal.

---

## B2 — Transcribe the Noblesville floodplain ordinance (blocks A1, letters)

**Why it is blocked:** Cloudflare bot protection on the American Legal code
library defeats automated retrieval. Not solvable by an agent without a real
browser session.

**Candidate sections identified:** §159.016 (definitions), §159.109.

**Steps:**
1. Open `https://codelibrary.amlegal.com/codes/noblesville` in Chrome.
2. Navigate to Title XV, Chapter 159 (Flood Hazard Areas).
3. Copy verbatim: the substantial damage definition, the 50% threshold
   language, the appeal / variance procedure and its deadline, and the section
   granting the floodplain administrator determination authority.
4. Paste into `docs/data-contracts/ordinance-citations.md` under the existing
   BLOCKED heading, with the section number and retrieval date beside each quote.

**Do not paraphrase.** This text goes into determination letters verbatim.

---

## B3 — Confirm the market-value basis with the Assessor (blocks M3 + M4)

**Why it is blocked:** the live parcel layer publishes only assessed values
(`AVLAND`, `AVIMPROVE`, `AVTOTGROSS` — tax year 2026). There is no market value
field. FEMA P-758 permits assessed value *adjusted to market*, so the
adjustment factor is the missing input.

**Contact (verified 2026-08-17):** Hamilton County Assessor, Kevin Poore —
317-776-9617, 33 N 9th Street, Suite 214, Noblesville. No published email found.

**Ask exactly this:**
1. Is there a published assessed-to-market ratio or sales-ratio study for
   Hamilton County that would let `AVTOTGROSS` be adjusted to market value?
2. For substantial damage determinations, does the county consider
   `AVIMPROVE` (improvement only) or `AVTOTGROSS` (including land) the correct
   denominator? *The 50% rule applies to the structure, so land should be
   excluded — confirm this.*
3. What is the assessment date the tax-year-2026 values reflect?

Record the answer in `docs/data-contracts/hamilton-county-parcels.md` under
"Gaps and risks", with the date and the name of who answered.

---

## Contact-verification warning

`docs/data-contracts/contacts.md` documents a case where a web search summary
produced a plausible but unverified email address for a Noblesville official
that direct page fetch did not reproduce. Do not use
`daschleman@noblesville.in.us` or phone `317-776-6325` — neither was confirmed.
Use the live "Email Denise Aschleman" link on
`https://www.noblesville.in.gov/283/Flood-Hazard-Mitigation` instead.
