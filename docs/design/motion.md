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

## Entrance motion (design v2, 2026-08-18) — a separate, additive category

Everything above this section is the CSS-only, functional-motion system from
the V3 pass, and it is **unchanged** — it still governs every pressed state,
selection swap, screen entry, loading indicator, and banner everywhere,
including on the three surfaces below. `direction.md`'s v2 amendment adds
one more category on top of it, permitted **only** on non-field surfaces
(landing, home, dashboard, admin) and **never** in `src/core/capture/**` or
any field-flow route, which keeps the five categories above as its only
motion, unchanged.

**6. Mount-time entrance choreography** (fade-rise, staggered lists, stat
count-ups) — landing hero text, home's role-aware sections and
queued-assessments list, the dashboard's stat panels and stat values. Built
with the `motion` package (`docs/adr/0010-motion-dependency.md` — package
choice, version, bundle impact) rather than plain CSS, because a
data-length-driven stagger and a from-zero numeric tween both need per-child/
per-frame JS control that CSS keyframes can't express cleanly. Tokens:

| Token | Value | Use for |
|---|---|---|
| `--motion-entrance-duration` | 260ms | One fade-rise step (opacity 0->1, translateY ~12px->0). |
| `--motion-entrance-stagger` | 60ms | Per-child delay in a staggered group. |

Both are duplicated as JS constants in `src/shared/ui/Entrance.tsx` /
`CountUp.tsx` (a CSS custom property can't feed a `motion/react` transition
option directly) — see that file's comment for the sync note. Implementation
lives in `src/shared/ui/Entrance.tsx` (`ENTRANCE_VARIANTS`,
`ENTRANCE_TRANSITION`, `STAGGER_GROUP_TRANSITION`, `useEntranceInitial()`)
and `src/shared/ui/CountUp.tsx`, consumed by `app/LandingHero.tsx`,
`app/home/RevealSection.tsx`, `app/home/QueuedAssessments.tsx`, and
`app/dashboard/Reveal.tsx`.

Reduced motion for this category is stricter than the blanket CSS safety net
above (which only zeroes CSS `animation-duration`/`transition-duration` —
irrelevant to a WAAPI-driven `motion` animation): `useEntranceInitial()`
returns `false` under `prefers-reduced-motion`, and `motion/react`'s
documented behavior for `initial={false}` is to render directly in the
final state with **no animation object created at all** — proven in
`test/e2e/motion.spec.ts`'s "Design v2" describe block via
`Element.getAnimations()`, not just a duration read. `CountUp` additionally
never renders anything but the real, final value on first paint (server-
rendered HTML included) — the count-up-from-zero only plays inside a
post-mount effect, and never at all under reduced motion. See
`docs/adr/0010-motion-dependency.md` "Reduced-motion compliance" for the
full reasoning.

The restrained water/flood-identity motif (`src/shared/ui/WaterMotif.tsx`,
landing hero + persistent header accent) is a **separate, ambient, looping**
animation, not an entrance — it stays plain CSS (`@keyframes`, no JS), same
category as the existing `loadingSweep` indicator above, and is frozen to a
static frame by the existing global `prefers-reduced-motion` safety net with
no code changes needed there.

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

### Design v2 pattern provenance (2026-08-18)

Per direction.md's v2 amendment #5 — patterns sourced from validated public
repos, adapted to tokens, provenance logged, nothing pasted wholesale.

- **Staggered text/element entrance** — technique vocabulary (per-child
  `motion.span`/`motion.div` with `variants` + `staggerChildren`, opacity +
  small translateY) confirmed against 21st.dev's animated-hero-section
  listing (`https://21st.dev/community/components/s/animated-hero-section`,
  retrieved 2026-08-18: "the animation is implemented using `motion.span` to
  apply staggered transitions to individual words... staggered to create a
  more dynamic feel"). **Taken**: the stagger/variants mechanism itself.
  **Rejected/re-themed**: every 21st.dev example found is per-word text
  splitting on a large display headline with a colored/gradient background —
  this pass applies the same mechanism to whole existing text nodes and
  list items instead (no word-splitting), on the existing white/blue/gray
  card, because per-word splitting reads as a marketing/product flourish,
  which direction.md's anti-goals explicitly rule out for this tool.
- **Number counter / stat count-up** — evaluated 21st.dev's number/stat
  listings (`https://21st.dev/community/components/s/number`,
  `https://21st.dev/s/animated-number-counter`, retrieved 2026-08-18) and
  motion.dev's own official counter pattern
  (`https://motion.dev/docs/react-animation`, retrieved 2026-08-18 —
  `useMotionValue` + `animate(count, target, { duration })`). **Taken**: the
  official motion.dev `useMotionValue`/`animate()` pattern directly (see
  `docs/adr/0010-motion-dependency.md` for why the purpose-built
  `AnimateNumber` component was rejected — it ships in the paid
  `motion-plus` package, not the approved `motion` dependency).
  **Rejected**: 21st.dev's community counter examples generally pair the
  count-up with an icon-topped stat card (rounded corners, soft shadow,
  sometimes a gradient accent) — exactly `ui-review-checklist.md` Part A's
  hard-fails; none of that visual treatment was carried over, only the
  count-up mechanism, applied to this app's existing plain text-forward
  `.statTile`/`.statCount` styling.
- **USWDS** (base system, unchanged provenance from the v1 pass) — the v2
  amendment's palette re-pull (cool grays, single blue family) and the
  Public Sans typeface both stayed inside real, cited USWDS grades/fonts;
  see `docs/design/tokens.css`'s v2 amendment header comment for the exact
  source files and retrieval dates.
- **Rejected outright, not adapted**: every gradient-background hero and
  glass/blur panel surfaced by the 21st.dev and general web searches during
  this pass — direction.md's anti-goals and `ui-review-checklist.md` Part A
  rule these out categorically, independent of how popular the pattern is.
