# UI Review Checklist

A mechanical checklist a reviewer runs against any UI PR. Derived strictly
from `docs/design/direction.md` and the "Role: frontend / UI agents"
section of `docs/agents/SUBAGENT.md`. Every line is checkable against the
actual PR — code, screenshots, or a running Playwright spec — not a matter
of taste. If an item can't be checked, the PR isn't reviewable yet; ask for
what's missing rather than guessing.

Run both sections. **Part A can pass while Part B fails, and that PR still
bounces** — a UI that avoids every hard-fail but ships static, feedback-free
screens is not done (direction.md → "Smooth, not decorative").

---

## Part A — Anti-slop hard fails

Any single "yes" here is an automatic bounce. Check the diff and a running
screenshot, not just the component names.

- [ ] Any purple→blue or purple→cyan gradient, or any decorative gradient
      at all, anywhere in the diff?
- [ ] Any glassmorphism, blur panel (`backdrop-blur`), or neon glow?
- [ ] An untouched `rounded-2xl shadow-lg p-6` card, or any card using a
      soft drop shadow for separation instead of a background-color step?
- [ ] A row of ≥3 identical cards, each with an icon + heading + two lines
      of text?
- [ ] A colored 3–4px left-border strip on a card or alert (the single
      most reliable AI tell — look at every `<Alert>`/banner/toast in the
      diff specifically)?
- [ ] A flat 1px gray border used as the *only* means of separating
      adjacent elements (no spacing or background-color step doing the
      real work)?
- [ ] Bounce, scale, or spring animation triggered by hover?
- [ ] Any raw hex value, `rgb()`, or named CSS color anywhere outside
      `docs/design/tokens.css`?
- [ ] Pure `#fff`/`white` or `#000`/`black` used as a background or text
      color anywhere (including inside `tokens.css` for `--color-surface`
      / `--color-text` specifically — those two must never be pure)?
- [ ] Any arbitrary Tailwind value (`p-[13px]`, `text-[#3b82f6]`,
      `w-[347px]`) or inline `style={{ }}` attribute?
- [ ] Does the overall palette read as timid/even, with no clear action
      color and no clear status-color meaning?
- [ ] Any hand-rolled button, badge, input, or dialog where one already
      exists in `docs/design/components.md`'s inventory? (Grep for a
      second implementation before approving a new one.)
- [ ] Any `rounded-full` usage anywhere (badges, avatars, buttons)?
- [ ] Any slider (`<input type="range">` or a custom drag component) used
      for a numeric input — damage percentage, market value, water depth,
      or anything else a field official would need to set with wet
      gloves?

**If any box is checked: bounce the PR. Do not negotiate case-by-case —
these are the literal, named hard-fails.**

---

## Part B — Smooth, not decorative (equally load-bearing)

A PR that passes all of Part A and fails here is *still not done*. Check
these against a running build (Playwright trace or manual click-through),
not just the source.

- [ ] **Immediate tap response.** Every interactive element shows a
      pressed/active state change within one frame of the tap — click a
      real button in the running app and confirm there is no dead gap
      before *any* visual change (even a color shift counts; a spinner
      alone does not).
- [ ] **Directional screen transitions.** In the capture flow specifically,
      does "Next" and "Back" feel like moving forward/backward along a
      sequence — not an abrupt cut, not a slow generic fade?
- [ ] **Calm loading/syncing.** Is there a clear, unhurried indicator for
      any async operation (search, photo upload, sync)? Confirm there is
      no frozen screen with zero feedback, and no jarring/alarming spinner
      implying an error when none exists.
- [ ] **Confident typography.** Does text use real weight/size choices
      from `--text-sm` … `--text-2xl`, or does any surface look like
      default browser text on white? (Reject "browser default" look even
      if a token was technically applied at a trivial size.)
- [ ] **No thin/light font weights anywhere** (direction.md → "Type" —
      they disappear in sunlight; check for `font-light`/`font-thin` or
      any custom weight <400 in the diff).
- [ ] **Spacing breathes.** Vertical rhythm uses `--space-1`…`--space-8`
      consistently; does any screen look cramped regardless of whether the
      colors are correct?
- [ ] **Designed error states.** Trigger a validation error on a real
      form in the diff — does it explain what to fix, in text, next to
      the field? (A default browser `alert()` or an unstyled red outline
      with no copy fails this.)
- [ ] **Designed empty states.** Find an empty list/table in the diff
      (dashboard with no cases, review queue with nothing pending, search
      with no results) — does it explain what will appear there, or is it
      a blank area?
- [ ] **Smooth response to input under load.** Scroll, tap through the
      capture flow, and trigger a photo capture on a throttled connection
      (Chrome DevTools "Slow 3G" or equivalent) — does interaction stay
      responsive, or does it stutter/jank?
- [ ] **Motion budget respected.** Any transition/animation in the diff is
      under 150ms, has no easing theatrics, and is gated behind
      `prefers-reduced-motion` (direction.md → "Motion")?

---

## Field-conditions and accessibility floor

Applies to every interactive surface, checked against the running app:

- [ ] Every tap target measures ≥48px, with ≥8px between adjacent targets
      (use browser devtools box model, not eyeballing).
- [ ] Every status (NOT_SD / BORDERLINE / SD / Draft) is conveyed by label
      **and** color — verify by viewing the screen in grayscale (devtools
      rendering emulation) and confirming it's still legible.
- [ ] Focus-visible is implemented and visible via keyboard `Tab` — not
      just present in CSS but actually reachable and visible in the
      running app, on every interactive element in the diff.
- [ ] Contrast: any new color used as text or a status indicator is
      checked with `node scripts/check-contrast.mjs` against
      `docs/design/tokens.css`, or — if it's a one-off combination the
      script doesn't cover — computed by hand and noted in the PR
      description.
- [ ] Auto-save on every capture-flow screen advance — no "Save" button
      that could be forgotten (confirm by killing the tab mid-flow and
      reloading, per AGENTS.md offline requirement).
- [ ] Offline state renders as a persistent banner, not a toast, not
      silent (trigger via devtools "Offline" and confirm).
- [ ] Every destructive action (override, supersede a determination, etc.)
      is confirmable, and reversible wherever the underlying action
      allows it.

---

## Proof, not screenshots

- [ ] A screenshot alone is not accepted as proof any interactive surface
      works. Confirm a Playwright spec exists that clicks the real control
      and asserts the real state change, and that it passes in CI.
- [ ] No `onClick={() => {}}`, no `TODO: connect`, no button that renders
      and does nothing — grep the diff for empty handlers before approving.
- [ ] No hardcoded/fake data rendered in `src/` — loading and empty states
      consume the real interface, not an inline array of sample rows.

---

## The acceptance question (direction.md, verbatim)

Before approving, ask both, and require both to pass:

1. Would this look correct hanging in a city building department, and
   could an official use it one-handed, in sunlight, with wet gloves, in
   under a minute?
2. Does it feel like a well-made instrument — immediate, clear,
   satisfying to use — or does it feel like a bare form rendered in a
   browser?

A UI that passes only the first is not done.
