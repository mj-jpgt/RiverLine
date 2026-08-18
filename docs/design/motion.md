# Motion Spec

One page, mechanical. This is what "Smooth, not decorative"
(`docs/design/direction.md`) compiles down to in CSS. If a motion rule you
need isn't here, it isn't approved — ask before adding a new one.

## Tokens (`docs/design/tokens.css`)

| Token | Value | Use for |
|---|---|---|
| `--motion-fast` | 100ms | Discrete, one-shot state changes: pressed state, selected-option swap, focus color step. |
| `--motion-base` | 140ms | Screen-entry / mount fades and directional slides. |
| `--motion-ease` | `ease-out` | The only easing curve used anywhere. No custom cubic-bezier. |

Both durations are under the direction.md "Motion" 150ms hard cap. There is
no third duration — if something doesn't fit `--motion-fast` or
`--motion-base`, it's the wrong kind of motion for this product, not a case
for a new token.

## The five categories (nothing else is approved)

1. **Pressed state.** Every tappable element (button, link, row, card)
   changes visibly within one frame of `:active` — a background-color step,
   a border-color step, or `transform: translateY(1px)`, using
   `--motion-fast`. Required on every interactive element, no exceptions.
2. **Selection swap.** Toggling a selected/unselected option (damage %,
   occupancy, foundation type, filters) transitions background/border/text
   color over `--motion-fast` instead of a hard instantaneous cut. Still
   reads as instant; it just doesn't strobe.
3. **Screen entry.** A route's `<main>` (or the capture flow's per-step
   screen) fades and slides in slightly (`translateX` ±16px → 0, opacity 0
   → 1) over `--motion-base` on mount. Forward-feeling by default
   (`translateX(16px)`); the capture flow additionally distinguishes
   Back (`translateX(-16px)`) because it tracks its own step direction in
   React state. Gated by `prefers-reduced-motion` — see below.
4. **Loading / syncing indicator.** A continuous, low-amplitude indicator
   (indeterminate bar or three-dot cadence) shown for any in-flight async
   operation, per direction.md's explicit "a sync indicator" motion
   category — this is not a one-shot transition and is not bound by
   `--motion-fast`/`--motion-base`; it loops slowly (~1.4s cycle) precisely
   so it reads as calm, not urgent. Never a fast/tight spin. Always paired
   with a text label — the animation is never the only signal.
5. **Banner / panel enter-exit.** Offline/sync banners and the like fade in
   over `--motion-base` in the direction the DOM already inserts them
   (top of shell). No slide, no bounce — a banner is inserted or removed by
   React, so only opacity is used; a slide would fight the layout reflow.

Nothing else. No parallax, no stagger/cascade delays across list items, no
`scale()` on hover, no shadow growth on hover, no keyframe that runs without
a real state change behind it.

## `prefers-reduced-motion`

Every animation/transition added by this pass is wrapped:

```css
@media (prefers-reduced-motion: reduce) {
  .thing { animation: none; transition: none; }
}
```

Reduced motion still requires the *end state* to be reachable instantly
(pressed state still changes color, selection still swaps) — only the
animated path between states is removed, never the feedback itself.

## Directional screen transitions: what's actually implemented

The capture flow (`app/capture/[id]/`) already tracks forward/back in React
state (`direction` in `CaptureFlow.tsx`) and re-keys its screen container
per step, so `.screenEnterForward` / `.screenEnterBack` genuinely know which
way the user is moving. That mechanism is specific to a single-component
multi-step flow and isn't reused as-is outside it.

For real page-to-page navigation (registry list → detail, determination
queue → review), this pass uses the CSS mount-animation pattern instead: a
`.pageEnter` utility (`src/shared/ui/motion.module.css`) applied to the
route's `<main>`, using the same forward-feeling slide direction, replayed
automatically because Next.js mounts a fresh instance of the segment on
every navigation. It does not distinguish true forward vs. back (a plain
`<Link>` doesn't know), so back-navigation gets the same forward-style
entrance rather than a mirrored one.

**Native View Transitions API** (`document.startViewTransition`) would give
true directional, cross-page transitions and was verified viable for the
primary field device — iOS Safari 18+ has full single-document support
(caniuse, retrieved 2026-08-18); iOS 18 shipped September 2024, so the
large majority of field iPhones are past that floor by August 2026. It is
**not wired up in this pass**: doing it correctly means intercepting
navigation at the shared router/layout level (`app/layout.tsx`,
`app/AppShell.tsx`), which sits outside a CSS-and-component-styles motion
pass and risks colliding with other agents editing shared shell code
concurrently. Flagged here as a good low-risk follow-up — it's a browser
API, not a new dependency.

## Research note: what was mined vs. rejected

Surveyed 21st.dev and general 2026 micro-interaction/loading-pattern
writeups for technique vocabulary, not aesthetics.

- **Took:** the general vocabulary of "pressed state must be immediate",
  "skeleton screens only pay off past ~400ms, otherwise they flicker"
  (used to justify *not* adding skeletons to sub-second loads — plain
  calm-indicator text/bar is enough here), and confirmation that a slow,
  steady indeterminate indicator is the standard "in progress, not stuck"
  signal.
- **Rejected:** 21st.dev's own showcase button pattern is literally
  `transition-transform hover:scale-105` — a hover-scale transform. That is
  the exact thing direction.md → "Smooth, not decorative" hard-fails
  ("Bounce, scale, or spring animation on hover") and
  `ui-review-checklist.md` Part A bans outright. Not used anywhere in this
  pass.
