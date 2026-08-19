# 0010 — `motion` as the entrance-animation dependency for non-field surfaces

Status: Accepted
Date: 2026-08-18

## Context

`docs/design/direction.md`'s v2 amendment (2026-08-18, owner directive) permits
staggered text/surface entrance animation and stat-tile count-ups on
**non-field surfaces only** (landing, home, dashboard, admin) — the capture
flow is explicitly excluded and keeps v1's plain-CSS, functional-only motion
rules (`docs/design/motion.md`, `--motion-fast`/`--motion-base`, under 150ms,
no stagger). AGENTS.md rule 3 requires an ADR before any new production
dependency; the v2 amendment pre-approves this one by name ("The `motion`
package (successor to framer-motion) is APPROVED as a dependency (ADR
required)"), so this ADR documents the concrete decision rather than
re-litigating whether a dependency is allowed at all.

Two things plain CSS keyframes cannot express without becoming unmaintainable:

1. **Per-child staggered reveal** on a list whose length is data-driven
   (the dashboard's stat rows, home's queued-assessments list) — CSS would
   need a hand-written `animation-delay` rule per possible child index, which
   breaks the moment the list is longer than however many were written.
2. **A from-zero count-up tween on a live numeric value** (stat tiles) — CSS
   cannot interpolate the text content of an element at all; this needs a
   JS-driven tween that writes intermediate formatted values per frame.

## Package identity and version — verified, not recalled

```
npm view motion version
```
returned **`13.1.0`** (checked in this task's environment, 2026-08-18) — not
written from memory, per AGENTS.md rule 4/SUBAGENT.md "Never invent". Installed
pinned to that exact version: `pnpm add motion@13.1.0` →
`package.json` `"motion": "13.1.0"`.

`motion` (npm: `motion`) is the current name of the library formerly published
as `framer-motion`; the v2 amendment names it as "successor to framer-motion,"
matching the package's own documentation at `https://motion.dev` (React usage
imported from the `motion/react` subpath — confirmed against the official
docs' own code samples, e.g. `https://motion.dev/docs/react-animation`,
retrieved 2026-08-18).

## What was considered

### (a) `motion` (`motion/react`) — chosen

- Pre-approved by name in the v2 amendment; no alternative needed sign-off.
- One package covers both use cases above: declarative `variants` +
  `staggerChildren` for list reveals, and the imperative `animate()` function
  (`useMotionValue`/`animate(from, to, { duration, onUpdate })`) for the
  count-up tween — confirmed against the library's own official example at
  `https://motion.dev/docs/react-animation` (retrieved 2026-08-18):
  ```js
  import { useMotionValue, motion, animate } from "motion/react"
  const count = useMotionValue(0)
  useEffect(() => {
    const controls = animate(count, 100, { duration: 5 })
    return () => controls.stop()
  }, [])
  ```
- Ships `useReducedMotion()` (`motion/react`) — a hook that reads
  `prefers-reduced-motion` and re-renders on change
  (`https://motion.dev/docs/react-use-reduced-motion`, retrieved
  2026-08-18) — used directly rather than re-implementing a
  `matchMedia` listener by hand.
- **Rejected sub-option: `AnimateNumber` from `motion-plus/react`.** This is
  the library's own purpose-built count-up component, but it ships in
  `motion-plus`, a **separate, paid add-on package**
  (`https://motion.dev/docs/react-animate-number`, retrieved 2026-08-18,
  states it "is exclusive to Motion+ members"). The v2 amendment approved
  only `motion`, not `motion-plus` — installing a second, paid dependency
  without a separate ADR/human sign-off is out of scope here. The count-up
  is instead hand-built on the base package's `useMotionValue`/`animate()`
  primitives (see Build notes below), which are sufficient for a simple
  numeric tween and cost nothing extra.

### (b) Hand-rolled `requestAnimationFrame` tween + IntersectionObserver — rejected

Would avoid a dependency entirely, but re-implements exactly what the v2
amendment pre-approved a library for (easing curves, stagger timing,
reduced-motion detection with live updates on setting change), with more
surface area for a subtle timing bug in exactly the kind of decorative code
that should not eat review time. Rejected because the amendment already
settled this trade-off in favor of the library.

### (c) CSS `@property` + `animation` counter tricks for the count-up — rejected

Possible in theory (animate a custom `@property` number and read it via
`counter()`/`content`), but Baseline support for `@property`-driven number
counters is inconsistent enough across the WebKit versions on older iOS field
devices (this project's actual device target, AGENTS.md/direction.md) to be a
real risk, and it still does nothing for the stagger-list requirement. Not
pursued.

## Decision

Use `motion@13.1.0`, imported from `motion/react`, in three new
**client-only** components under `src/shared/ui/` (`Entrance.tsx` —
`FadeRise`/`StaggerGroup`/`StaggerItem` — and `CountUp.tsx`), consumed only by
`app/page.tsx`, `app/home/**`, and `app/dashboard/page.tsx`. Nothing in
`src/core/capture/**`, `app/api/capture/**`, `app/api/photos/**`, or any other
field-flow route imports `motion` — the v2 amendment is explicit that the
capture flow keeps v1's CSS-only functional motion, and per-route code
splitting in the Next.js App Router means the capture flow's client bundle
never pulls this dependency in regardless.

## Bundle impact

Measured by the library's own documentation, not estimated:
`https://motion.dev/docs/react-reduce-bundle-size` (retrieved 2026-08-18)
states the full `motion` component is **~34kB**, and that `LazyMotion` +
the `m` component can shrink the *initial* load to **4.6kB**, deferring an
additional `domAnimation` feature bundle (**+15kB**) on demand.

This pass uses the plain `motion` import (not `LazyMotion`/`m`), accepting
the ~34kB figure, for two reasons:

1. Usage is confined to three route segments that are explicitly
   **non-field, non-offline-critical** surfaces (landing, home, dashboard) —
   the ~34kB lands only in those routes' client chunks, not in the shared
   app-shell bundle every page pays for, and never in the capture-flow bundle
   an assessor loads once and uses offline for the rest of a field visit.
2. All three consuming components (`FadeRise`, `StaggerGroup`/`StaggerItem`,
   `CountUp`) are simple enough — one-shot mount variants and a single
   `animate()` tween, no drag/pan/layout animations — that `LazyMotion`'s
   extra indirection (swapping `motion.div` for `m.div`, wrapping every
   consuming tree in a `<LazyMotion features={...}>` provider) is not
   justified by the ~30kB difference for a non-field surface. Flagged here as
   a legitimate follow-up if a future measurement shows it matters in
   practice — not done in this pass to keep the change contained to this
   task's owned surfaces.

## Reduced-motion compliance

Every component built on `motion` in this pass follows the same rule as every
existing CSS transition in the codebase (`docs/design/motion.md`
"`prefers-reduced-motion`"): the **end state is always reachable instantly**,
only the animated path is removed.

- `FadeRise`/`StaggerGroup` call `useReducedMotion()` and pass `initial={false}`
  when it's `true` — Motion's own documented behavior for `initial={false}` is
  to render directly in the `animate` state with no mount transition at all
  (no opacity-0 flash, nothing to "catch up" on).
- `CountUp` renders the **real, final formatted value** in its very first
  render (server-rendered HTML included — no "0" is ever server-rendered or
  visible to a no-JS/slow-hydration client or a screen reader that reads
  before hydration). The count-up-from-zero tween is applied only inside a
  post-mount `useEffect`, and only runs at all when `useReducedMotion()` is
  `false`; under reduced motion the effect is a no-op and the correct value
  never changes. This is stricter than direction.md strictly requires,
  chosen deliberately: AGENTS.md's "no hardcoded/fake data" and "output has
  legal consequences" rules make a transient incorrect number an unacceptable
  risk on a page a field official might screenshot or read aloud, even for a
  few hundred milliseconds.
- `test/e2e/motion.spec.ts` gets new assertions (per this task) proving both:
  entrance motion is present under normal settings, and fully absent (no
  animation duration, immediate correct end state) under
  `page.emulateMedia({ reducedMotion: "reduce" })`.

## Consequences

- One new production dependency, pinned to an exact verified version.
- Confined to three client components and three route segments, all outside
  `src/core/capture/**` and any offline-critical path.
- The existing CSS-only `--motion-fast`/`--motion-base` system in
  `docs/design/motion.md` is unchanged and still governs every functional
  state-change transition everywhere, including inside the three surfaces
  this ADR touches (pressed states, selection swaps) — this ADR adds a
  second, JS-driven category for mount-time entrance choreography only, it
  does not replace the first.

## Sources

- `npm view motion version` — run in this task's environment, 2026-08-18,
  returned `13.1.0`.
- `https://motion.dev/docs/react-animation` — `useMotionValue`/`animate()`
  counter example. Retrieved 2026-08-18.
- `https://motion.dev/docs/react-use-reduced-motion` — `useReducedMotion()`
  hook behavior. Retrieved 2026-08-18.
- `https://motion.dev/docs/react-animate-number` — confirms `AnimateNumber`
  is a `motion-plus/react` (paid) export, not part of the base `motion`
  package. Retrieved 2026-08-18.
- `https://motion.dev/docs/react-reduce-bundle-size` — bundle-size figures
  (~34kB full, 4.6kB `LazyMotion` initial + 15kB `domAnimation`). Retrieved
  2026-08-18.
