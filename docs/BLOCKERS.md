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

## B4 — CODE READY — needs a provider API key (blocks production M0 auth)

**Status (2026-08-18, T-V2): code ready — needs provider API key.** The
provider decision, ADR, and full implementation are done:
`docs/adr/0009-email-transport.md` compares Postmark, Resend, and AWS SES
and recommends **Postmark** (plain HTTPS JSON API, no new npm dependency —
AGENTS.md rule 3 satisfied by construction, not by exception).
`src/core/auth/email-transport.ts` implements a driver-selected transport
(`EMAIL_DRIVER=dev|http|none`) with a tested Postmark payload builder
(`test/unit/auth/email-transport.test.ts`); `magic-link.ts` now calls it
instead of inlining the throw. **The only missing piece is a real Postmark
Server Token** — this cannot be fabricated or worked around; see
`.env.example` for the exact env vars and where the key comes from.

**What still needs a human:**
1. Create/access a Postmark account for the jurisdiction (or confirm via
   whoever owns the jurisdiction's IT/email policy that Postmark is
   acceptable — a `.gov` domain may have constraints on third-party mail
   relays; ADR 0009's "Consequences" section covers switching providers if
   not).
2. Verify the sending domain in Postmark (DKIM DNS records) so mail
   reliably lands in inboxes rather than spam.
3. Set `EMAIL_DRIVER=http`, `EMAIL_API_URL`, `EMAIL_API_KEY` (the Postmark
   Server Token from step 1), `EMAIL_FROM`, and `APP_BASE_URL` (must be
   `https://` in production) in the production environment.

Until then, production `requestMagicLink()` continues to throw a clear,
loud error (`EMAIL_DRIVER` unset defaults to `"none"` in production) —
never a fake send, never a silent no-op.

**Original context (why this was blocked):** `src/core/auth/magic-link.ts`
implements the full allowlist → single-use-token → verify flow, and in dev
the link is logged server-side and served from a dev-only route
(`app/api/dev/magic-link/route.ts`) — see
`docs/journal/2026-08-17-c1-auth-db.md`.

---

## Contact-verification warning

`docs/data-contracts/contacts.md` documents a case where a web search summary
produced a plausible but unverified email address for a Noblesville official
that direct page fetch did not reproduce. Do not use
`daschleman@noblesville.in.us` or phone `317-776-6325` — neither was confirmed.
Use the live "Email Denise Aschleman" link on
`https://www.noblesville.in.gov/283/Flood-Hazard-Mitigation` instead.
