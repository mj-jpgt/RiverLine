// Design v2 — restrained flood-instrument identity element (docs/design/
// direction.md "v2 amendment" #2: "a restrained water motif... an animated
// water line, level gauge, or slow current rendered in CSS/SVG/canvas...
// Subtle, monochrome-blue, never busy. NO stock video files, NO emojis").
//
// Pure SVG + CSS keyframe animation, no JS/motion package — this is a
// continuous ambient loop (like the existing --motion-base loadingSweep
// pattern in src/shared/ui/motion.module.css), not a mount-time entrance, so
// it belongs in the same plain-CSS category as that indicator rather than
// the JS-driven entrance components in Entrance.tsx/CountUp.tsx. No hooks
// used, so this stays a server component — safe to render from
// app/page.tsx and inside AppHeader.tsx without adding a client boundary.
//
// Wave path is a single periodic sine-like curve (period 300 user units,
// amplitude 10) spanning six full periods (-300 to 1800) so a CSS
// translateX of exactly one period (-300) loops seamlessly with no visible
// seam or gap, animated at a slow, calm cadence (direction.md "Motion":
// "no easing theatrics" — linear, not eased, is the calmest reading for a
// continuous loop; matches src/shared/ui/motion.module.css's own
// loadingSweep choice of a steady, non-eased cadence for the same reason).
// Frozen to a single static frame under prefers-reduced-motion by the
// existing global safety net in app/globals.css (no extra media query
// needed here — every animation-duration in the app already collapses
// there) — the wave stays visible as a still line, never disappears.
import styles from "./WaterMotif.module.css";

const WAVE_PATH =
  "M -300,30 C -262.5,20 -187.5,20 -150,30 C -112.5,40 -37.5,40 0,30 " +
  "C 37.5,20 112.5,20 150,30 C 187.5,40 262.5,40 300,30 " +
  "C 337.5,20 412.5,20 450,30 C 487.5,40 562.5,40 600,30 " +
  "C 637.5,20 712.5,20 750,30 C 787.5,40 862.5,40 900,30 " +
  "C 937.5,20 1012.5,20 1050,30 C 1087.5,40 1162.5,40 1200,30 " +
  "C 1237.5,20 1312.5,20 1350,30 C 1387.5,40 1462.5,40 1500,30 " +
  "C 1537.5,20 1612.5,20 1650,30 C 1687.5,40 1762.5,40 1800,30";

export type WaterMotifVariant = "hero" | "accent";

export interface WaterMotifProps {
  variant?: WaterMotifVariant;
  className?: string;
}

/**
 * A slow, calm current — a filled water body with a crisp line tracing its
 * surface, monochrome blue, always token-driven (no raw hex — fill/stroke
 * are `currentColor`, colored by the wrapping element's `color`).
 * `variant="hero"` is the landing-page identity element; `variant="accent"`
 * is the thin echo used in the persistent shell header.
 */
export function WaterMotif({ variant = "hero", className }: WaterMotifProps) {
  const rootClass = variant === "hero" ? styles.hero : styles.accent;
  return (
    <svg
      className={`${rootClass} ${className ?? ""}`}
      viewBox="0 0 1200 64"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g className={styles.waveGroup}>
        <path d={`${WAVE_PATH} L 1800,64 L -300,64 Z`} className={styles.waveFill} />
        <path d={WAVE_PATH} className={styles.waveLine} />
      </g>
    </svg>
  );
}
