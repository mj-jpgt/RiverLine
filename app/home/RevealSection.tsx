"use client";

// Design v2 entrance motion for /home's role-aware sections (docs/design/
// direction.md "v2 amendment" #4). Colocated client island, same pattern as
// this folder's existing QueuedAssessments.tsx — a small typed wrapper
// rather than a generic polymorphic component (see src/shared/ui/Entrance.tsx
// file comment for why: motion/react's per-tag prop types don't dispatch
// cleanly through a runtime-selected union). Wraps the page's existing
// <section aria-label="..."> elements directly — no extra DOM wrapper — so
// nothing about their structure or the Playwright locators that scope to
// them (test/e2e/shell.spec.ts) changes.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { ENTRANCE_VARIANTS, ENTRANCE_TRANSITION, ENTRANCE_STAGGER_S, useEntranceInitial } from "@/shared/ui";

export interface RevealSectionProps {
  children: ReactNode;
  className?: string;
  /** Omit for the page's plain header block, which was never a <section> in v1 — this preserves that exact DOM shape. */
  ariaLabel?: string;
  /** 0-based position among the page's top-level reveal blocks — each step adds one more stagger delay. */
  order: number;
}

export function RevealSection({ children, className, ariaLabel, order }: RevealSectionProps) {
  const initial = useEntranceInitial();
  const transition = { ...ENTRANCE_TRANSITION, delay: order * ENTRANCE_STAGGER_S };

  if (ariaLabel === undefined) {
    return (
      <motion.div className={className} initial={initial} animate="visible" variants={ENTRANCE_VARIANTS} transition={transition}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.section
      className={className}
      aria-label={ariaLabel}
      initial={initial}
      animate="visible"
      variants={ENTRANCE_VARIANTS}
      transition={transition}
    >
      {children}
    </motion.section>
  );
}
