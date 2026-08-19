"use client";

// Design v2 — entrance motion for non-field surfaces (docs/design/
// direction.md "v2 amendment" #4; package choice + rationale in
// docs/adr/0010-motion-dependency.md). This is a SEPARATE category from the
// CSS-only --motion-fast/--motion-base system in docs/design/motion.md,
// which is unchanged and still governs every functional state-change
// transition everywhere, including inside the pages that use these
// components. Used only by app/page.tsx, app/home/**, and
// app/dashboard/page.tsx — never by src/core/capture/** or any field-flow
// route (the capture flow keeps v1's plain-CSS, functional-only motion).
//
// src/shared/** is a leaf under eslint-plugin-boundaries
// (docs/adr/0003-module-boundary-enforcement.md): no core/module imports
// here, presentational only.
//
// Deliberately NOT a polymorphic "as" wrapper component: motion/react
// exposes one concrete component per intrinsic element (motion.div,
// motion.section, motion.li, ...), each with its own element-specific prop
// types, and dispatching through a runtime-selected union defeats that
// typing. Call sites import `motion` directly from "motion/react" and use
// the concrete tag they need (motion.section, motion.li, ...), applying the
// shared timing/variants/reduced-motion values exported from this file so
// every entrance animation in the app stays in sync.
import { useReducedMotion, type Variants, type Transition } from "motion/react";

// Mirrors docs/design/tokens.css --motion-entrance-duration/-stagger.
// Duplicated as JS constants (a CSS custom property cannot feed a
// motion/react transition option directly) — see the token comment for why
// these two must be kept in sync by hand.
const DURATION_S = 0.26; // --motion-entrance-duration: 260ms
export const ENTRANCE_STAGGER_S = 0.06; // --motion-entrance-stagger: 60ms
const RISE_PX = 12;

/** opacity 0->1, translateY ~12px->0 — the one entrance shape used everywhere. */
export const ENTRANCE_VARIANTS: Variants = {
  hidden: { opacity: 0, y: RISE_PX },
  visible: { opacity: 1, y: 0 },
};

export const ENTRANCE_TRANSITION: Transition = { duration: DURATION_S, ease: "easeOut" };

/** Transition for the wrapping element of a staggered group of ENTRANCE_VARIANTS children. */
export const STAGGER_GROUP_TRANSITION: Transition = { staggerChildren: ENTRANCE_STAGGER_S };

/**
 * Returns the `initial` prop value every entrance-animated motion.* element
 * in this app should use: `"hidden"` normally, or `false` under
 * prefers-reduced-motion. motion/react's documented behavior for
 * `initial={false}` is to render directly in the `animate` state with no
 * mount transition and no opacity-0 flash to "catch up" on — the correct
 * content is present immediately, only the animated path is removed
 * (docs/design/motion.md "prefers-reduced-motion", applied here to the new
 * JS-driven category).
 */
export function useEntranceInitial(): "hidden" | false {
  const reduceMotion = useReducedMotion();
  return reduceMotion ? false : "hidden";
}
