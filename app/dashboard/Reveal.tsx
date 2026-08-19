"use client";

// Design v2 entrance motion for the administrator dashboard (docs/design/
// direction.md "v2 amendment" #4). Colocated client islands, same reasoning
// as app/home/RevealSection.tsx (concrete typed wrappers rather than a
// polymorphic component — see src/shared/ui/Entrance.tsx's file comment).
// No DOM structure change to the existing .statsGrid / .statsGroup divs
// this wraps — same class names, same nesting, only the entrance behavior
// is added.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { ENTRANCE_VARIANTS, ENTRANCE_TRANSITION, STAGGER_GROUP_TRANSITION, useEntranceInitial } from "@/shared/ui";

/** A single fade-rise block, e.g. the page header. */
export function RevealBlock({ children, className }: { children: ReactNode; className?: string }) {
  const initial = useEntranceInitial();
  return (
    <motion.div className={className} initial={initial} animate="visible" variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
      {children}
    </motion.div>
  );
}

/** Wraps a set of RevealItem children (e.g. a .statsGrid's .statsGroup panels) and staggers their entrance. */
export function RevealGroup({ children, className, ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  const initial = useEntranceInitial();
  return (
    <motion.section
      className={className}
      aria-label={ariaLabel}
      initial={initial}
      animate="visible"
      variants={{ visible: { transition: STAGGER_GROUP_TRANSITION } }}
    >
      {children}
    </motion.section>
  );
}

/** One direct child of a RevealGroup. */
export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
      {children}
    </motion.div>
  );
}
