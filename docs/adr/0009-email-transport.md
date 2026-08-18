# 0009 — Production email transport for magic-link delivery

Status: Accepted (implementation ready; sending is blocked on a real
provider API key — see docs/BLOCKERS.md B4)
Date: 2026-08-18

## Context

`src/core/auth/magic-link.ts` implements the full allowlist → single-use-
token → verify flow (docs/journal/2026-08-17-c1-auth-db.md). In dev, the
link is logged server-side and served from a dev-only route
(`app/api/dev/magic-link/route.ts`); in production, `requestMagicLink()`
has been throwing a clear, loud error instead of pretending to send real
mail, because no email transport existed and AGENTS.md rule 3 requires an
ADR before adding any new dependency. This is `docs/BLOCKERS.md` B4.

**Hard constraint carried into this decision, not just a preference:**
AGENTS.md rule 3 also means *no new npm dependency at all* unless a human
signs off in an ADR first, and this task was explicitly scoped to avoid
that ask — so the transport must be reachable with the runtime's own
`fetch` (global since Node 18, and this project pins Node 22 LTS —
AGENTS.md "Stack") against a plain HTTPS JSON API. That constraint alone
rules out any provider whose supported integration path is "install our
SDK" or "use SMTP" (an SMTP client is itself a new dependency, and Node's
built-in `net`/`tls` modules do not include an SMTP implementation).

## Options considered

### (a) Postmark — plain HTTPS JSON API, no SDK required. **Recommended.**

- **Endpoint**: `POST https://api.postmarkapp.com/email`
  (`https://postmarkapp.com/developer/api/email-api`, retrieved 2026-08-17).
- **Auth**: a single header, `X-Postmark-Server-Token: <server token>` — no
  request signing, no SDK.
- **Body** (JSON): `From`, `To`, `Subject`, `TextBody`, `HtmlBody`,
  `MessageStream` (defaults to Postmark's dedicated **transactional**
  stream, `"outbound"`, kept separate from any broadcast/marketing stream
  — this matters for reputation: a magic-link sender should never share
  send-reputation with bulk mail).
- **Free plan**: 100 emails/month, "no credit card required," "never
  expires or runs out" (`https://postmarkapp.com/pricing`, retrieved
  2026-08-17). A field tool with a handful of jurisdiction staff logging in
  a few times a week is comfortably inside 100/month; this ADR does not
  need to justify a paid tier to make the recommendation.
- **Domain verification / DKIM**: available on every plan including free —
  "Domain verification is available for all customers today... For each
  domain you add, you will receive a unique DKIM key to add to your DNS"
  (`https://postmarkapp.com/support/article/how-do-i-verify-a-domain`,
  retrieved 2026-08-17). This is the deliverability-relevant fact for this
  project specifically: recipients are jurisdiction staff, plausibly on
  `.gov`/`.us` government mail systems with strict inbound filtering, and
  DKIM + a dedicated transactional stream (not shared with any bulk sender
  on the same infrastructure) is exactly the profile that reduces the
  chance of a magic link landing in spam or being rejected outright. Google/
  Yahoo/Microsoft's 2026 sender guidelines make SPF+DKIM+DMARC the baseline
  expectation for any authenticated sender regardless of volume; a
  government mail relay is realistically at least as strict, not more
  lenient (general finding, not a claim about any specific `.gov` system —
  no `.gov`-specific deliverability policy was found as a primary source).
- **Postmark's own positioning is specifically transactional-email
  deliverability** (not a general marketing-email platform diluting shared
  IP reputation with bulk sends) — the product itself is scoped to exactly
  this project's use case.

### (b) Resend — plain HTTPS JSON API, no SDK required. Close runner-up.

- **Endpoint**: `POST https://api.resend.com/emails`
  (`https://resend.com/docs/api-reference/emails/send-email`, retrieved
  2026-08-17).
- **Auth**: `Authorization: Bearer <api key>` header — also no SDK required,
  equally simple to call with `fetch`.
- **Body** (JSON): `from`, `to`, `subject`, `html`, `text` (text is
  auto-generated from html if omitted — this project ships an explicit
  text part regardless, per its own content requirement below).
- **Free plan**: 3,000 emails/month, capped at 100/day, 1 verified domain,
  30-day data retention (`https://resend.com/pricing`, retrieved
  2026-08-17) — a materially larger free allotment than Postmark's.
- **Why it's not the #1 pick**: Resend is a newer entrant (public API
  launched 2023) with a shorter track record specifically on inbox
  placement into strict enterprise/government mail systems, versus
  Postmark's long-standing reputation built specifically around
  transactional deliverability. For a tool whose entire login path depends
  on one email reliably reaching one inbox, and where the recipients are
  government staff (not a general consumer audience), the deliverability
  track record matters more here than the larger free tier — this project's
  real volume (a handful of jurisdiction officials) will never approach
  either provider's free-tier ceiling, so Resend's higher cap buys nothing
  in practice. Domain verification (DKIM) is available on Resend too;
  nothing here disqualifies it — it is a legitimate second choice if the
  jurisdiction's IT/email policy (docs/BLOCKERS.md B4, step 1) already has
  a Resend relationship.

### (c) AWS SES, raw HTTPS API — considered and rejected for this constraint.

- SES does have a plain HTTPS API (`POST /v2/email/outbound-emails` etc.),
  but every request must be signed with **AWS Signature Version 4**. AWS's
  own documentation is explicit that this is non-trivial to hand-roll:
  "SigV4 signature calculation can be a complex undertaking, and we
  recommend that you use the AWS SDKs or CLI whenever possible... if you're
  making raw HTTP requests without using an SDK, you need to sign them
  manually"
  (`https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html`,
  retrieved 2026-08-17). Implementing SigV4 signing by hand inside an
  auth-adjacent, legally-consequential code path is exactly the kind of
  place a subtle correctness/security bug would hide — and doing it
  *correctly* in practice means either a new dependency (`aws4fetch` or
  similar) or a nontrivial from-scratch canonical-request/signing
  implementation, both of which defeat the "no new dependency, no
  significant new attack surface" goal of this task. Rejected on that basis
  alone, independent of SES's actual deliverability (which is not in
  question).

## Decision

**Postmark, driven by `EMAIL_DRIVER=http`.** Reasons, in priority order:

1. Deliverability to the actual recipient population (jurisdiction
   officials, plausibly on institutional/government mail systems) is the
   dominant risk for this feature — a magic link that lands in spam is a
   login that silently fails. Postmark's product is built specifically
   around transactional deliverability and keeps a dedicated transactional
   stream separate from any bulk-mail reputation risk.
2. The free plan (100/month, no credit card, never expires) is real
   headroom for this project's actual volume and removes procurement
   friction — the jurisdiction does not need to commit to a paid contract
   to get this working.
3. Domain verification/DKIM is available on every plan, so the eventual
   real deployment is not gated behind an upgrade.
4. The plain-JSON, single-header-auth API is exactly as easy to call with
   `fetch` as Resend's — no advantage to (b) on implementation complexity,
   so the deliverability argument for (a) is not traded against anything.

**No new npm dependency is added.** `src/core/auth/email-transport.ts`
calls Postmark's endpoint with the Node/Next.js runtime's built-in global
`fetch`.

## Implementation

- `EMAIL_DRIVER` env var selects the driver: `"dev"` (log + dev-route
  stash, non-production only), `"http"` (real send via the driver below),
  `"none"` (loud throw — the default when unset in production, matching
  the pre-existing inline throw this replaces).
- `"http"` driver config, all env-driven, no hardcoded provider secrets:
  - `EMAIL_API_URL` — set to `https://api.postmarkapp.com/email` for the
    Postmark integration this ADR ships. (Kept as an env var, not a
    hardcoded constant, so a future swap to another Postmark-compatible
    endpoint — e.g. a sandbox/staging server — doesn't need a code change.)
  - `EMAIL_API_KEY` — the Postmark **Server Token** (Server → API Tokens
    tab in the Postmark dashboard, per
    `https://postmarkapp.com/developer/api/overview`, retrieved
    2026-08-17). This is the piece only a human with a real Postmark
    account can produce — see docs/BLOCKERS.md B4.
  - `EMAIL_FROM` — the verified sender address (Sender Signature or,
    preferably, a fully domain-verified `no-reply@<jurisdiction-domain>`).
  - `APP_BASE_URL` — required to build the absolute verify link mailed to
    a real inbox (dev mode never needed this: the dev-only route just
    returns the relative path). Validated to start with `https://` when
    `NODE_ENV=production`.
- Payload builder (`buildPostmarkPayload`) is exported and covered by exact-
  JSON unit tests (`test/unit/auth/email-transport.test.ts`) so a future
  edit to the email content can't silently drift from what Postmark's API
  actually expects.
- Email content: plain text is mandatory (institutional tone, the link, a
  "this link expires in 15 minutes" note, "if you did not request this,
  ignore this email" — no marketing copy, no images); a matching simple
  HTML part is included, also with no images and no tracking pixels/links.
- Security: the raw token only ever appears embedded in `verifyUrl`, which
  only reaches either (a) the dev-only console log + in-memory store
  (structurally unreachable when `NODE_ENV=production` — enforced twice,
  see `resolveEmailDriver()`), or (b) the outbound HTTPS request body sent
  directly to Postmark. No log line or thrown error in the `"http"`/`"none"`
  paths ever contains the token or the full verify URL. Rate limiting for
  the request-link route already exists upstream
  (`app/api/auth/request-link/route.ts`, `src/shared/security/rate-limit.ts`)
  and is not duplicated here.

## Consequences

- Real production magic-link email is fully implemented and unit-tested
  against a mocked `fetch`, but **cannot actually send mail until a human
  supplies a real Postmark server token** — this ADR does not and cannot
  create that credential. `test/unit/auth/email-transport.test.ts`'s "live
  send" test is gated on `EMAIL_API_KEY` (plus `EMAIL_API_URL`/
  `EMAIL_FROM`) being present in the environment and visibly skips
  otherwise; it did not run in this task's environment because no key is
  configured yet.
- If the jurisdiction's IT/email policy (docs/BLOCKERS.md B4 step 1) turns
  out to already have a Resend relationship, or objects to Postmark
  specifically, switching providers means writing a new payload builder
  (Resend's shape differs: `Authorization: Bearer`, lowercase field names,
  `html`/`text` instead of `HtmlBody`/`TextBody`) and pointing
  `EMAIL_API_URL` at Resend's endpoint — a small, contained change, not a
  redesign, because the driver interface itself (`sendMagicLinkEmail`,
  `resolveEmailDriver`) is provider-agnostic.
- The jurisdiction's domain must complete Postmark's DKIM DNS verification
  before real mail will reliably land in inboxes rather than spam — that is
  an account-setup step for whoever configures the Postmark account, not
  something this code can do.

## Sources

- `https://postmarkapp.com/developer/api/email-api` — endpoint, headers,
  request/response body fields. Retrieved 2026-08-17.
- `https://postmarkapp.com/developer/api/overview` — where the Server
  Token comes from. Retrieved 2026-08-17.
- `https://postmarkapp.com/pricing` — free plan volume/cost/credit-card
  terms. Retrieved 2026-08-17.
- `https://postmarkapp.com/support/article/how-do-i-verify-a-domain` — DKIM
  domain verification available on all plans. Retrieved 2026-08-17.
- `https://resend.com/docs/api-reference/emails/send-email` — endpoint,
  headers, request body fields. Retrieved 2026-08-17.
- `https://resend.com/pricing` — free plan volume/domain/retention terms.
  Retrieved 2026-08-17.
- `https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html` —
  AWS's own statement that SigV4 signing is complex and the SDK/CLI is the
  recommended path for raw HTTP requests. Retrieved 2026-08-17.
- General 2026 sender-authentication context (Gmail/Yahoo/Microsoft
  expecting SPF+DKIM+DMARC for authenticated senders) drawn from multiple
  secondary industry summaries — used only as general background on why
  DKIM/domain verification matters, not as a source for any specific number
  or `.gov`-specific policy; no primary `.gov` mail-system deliverability
  policy was found and none is claimed here.
