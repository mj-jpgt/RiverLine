"use client";

// Design v2 — stat-tile count-up (docs/design/direction.md "v2 amendment"
// #4: "number count-ups on stats"). Package choice + reduced-motion
// reasoning: docs/adr/0010-motion-dependency.md.
//
// SAFETY PROPERTY (deliberate, stricter than the amendment strictly
// requires): the value rendered on first paint — server-rendered HTML
// included — is always the REAL, FINAL, correctly formatted number. A
// count-up-from-zero animation only ever starts inside a post-mount
// useEffect, and only when the browser is not asking for reduced motion.
// A no-JS client, a screen reader that reads before hydration, or a
// reduced-motion user never sees anything but the correct value. AGENTS.md
// "no hardcoded/fake data" and "output has legal consequences" make a
// transient wrong number on a screen an official might read aloud or
// screenshot an unacceptable risk, even for a few hundred milliseconds —
// this is not the kind of thing an ADR gets to trade away for polish.
import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

export interface CountUpProps {
  /** The real value. Rendered immediately and exactly on first paint. */
  value: number;
  /** Formats a (possibly fractional, mid-animation) number for display. */
  format?: (n: number) => string;
  className?: string;
  /** Milliseconds. Default matches --motion-entrance-duration x ~2 — long
   *  enough to read as a count, short enough to never feel slow. */
  durationMs?: number;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-US");

export function CountUp({ value, format = defaultFormat, className, durationMs = 500 }: CountUpProps) {
  const reduceMotion = useReducedMotion();
  // Always starts (SSR + first client render, before any effect runs) at
  // the real formatted value — see file-level comment.
  const [display, setDisplay] = useState(() => format(value));
  const mountedOnce = useRef(false);

  useEffect(() => {
    // Reduced motion: never animate, never touch the display value — it is
    // already correct from the initial render above. Guards on
    // `!== false` rather than a plain truthy check deliberately: useReducedMotion()
    // returns `null` before it has synchronously resolved the real
    // matchMedia state (SSR / the earliest instant of hydration), and
    // treating "unknown yet" the same as "definitely not reduced" would
    // risk starting the from-zero tween before the reduced-motion setting
    // is actually known. Only a confirmed `false` unlocks the animation;
    // once reduceMotion resolves either way this effect re-runs (it's a
    // dependency below) and does the right thing.
    if (reduceMotion !== false) return;

    // Skip the from-zero flourish on every re-render of an unchanged value
    // (e.g. a parent re-render from unrelated state) — only animate on the
    // very first mount and on genuine value changes, from the previous
    // displayed number to the new one (never from zero on a value change,
    // which would misrepresent a small decrease as a large jump).
    const from = mountedOnce.current ? Number.parseFloat(display.replace(/[^0-9.-]/g, "")) || 0 : 0;
    mountedOnce.current = true;

    if (from === value) {
      setDisplay(format(value));
      return;
    }

    const controls = animate(from, value, {
      duration: durationMs / 1000,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(format(latest)),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes `display`/`format` (recomputed from ref, not a reactive dependency)
  }, [value, reduceMotion, durationMs]);

  return <span className={className}>{display}</span>;
}
