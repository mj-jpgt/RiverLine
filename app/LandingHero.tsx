"use client";

// Client island for the unauthenticated landing page (app/page.tsx stays a
// server component — it needs `cookies()`/`redirect()`, which a client
// component can't do). Design v2 (docs/design/direction.md "v2 amendment"):
// the flood-instrument identity (WaterMotif hero) + staggered fade-rise
// entrance via the `motion` package (docs/adr/0010-motion-dependency.md).
// Content is unchanged from v1 — "the same honest content (what it is, who
// uses it, sign in)" per this task's brief; only the presentation layer
// changed. test/e2e/shell.spec.ts's role/text queries below are preserved
// verbatim (getByRole("heading", {name:"RiverLine SDD"}), "Sign in" link,
// etc.) — see that file for the exact assertions this must keep satisfying.
import Link from "next/link";
import { motion } from "motion/react";
import {
  WaterMotif,
  ENTRANCE_VARIANTS,
  ENTRANCE_TRANSITION,
  STAGGER_GROUP_TRANSITION,
  useEntranceInitial,
} from "@/shared/ui";
import styles from "./page.module.css";

const FACTS: { label: string; value: string }[] = [
  { label: "Used by", value: "Jurisdiction assessors and floodplain officials" },
  { label: "Decision-maker", value: "The local official — this tool proposes, it never adopts" },
  { label: "Access", value: "Jurisdiction-issued accounts only — no self-signup" },
];

export function LandingHero() {
  const initial = useEntranceInitial();

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <WaterMotif variant="hero" className={styles.wave} />

        <motion.div
          className={styles.cardBody}
          initial={initial}
          animate="visible"
          variants={{ visible: { transition: STAGGER_GROUP_TRANSITION } }}
        >
          {/* h1 is the literal product name — test/e2e/smoke.spec.ts asserts
              getByRole("heading", { name: "RiverLine SDD" }) on this route,
              and Playwright's role-name matching is substring/case-
              insensitive by default, so this must be the heading text
              itself, not just visible text elsewhere on the page. */}
          <motion.h1 className={styles.heading} variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
            RiverLine SDD
          </motion.h1>
          <motion.p className={styles.eyebrow} variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
            Substantial-damage determination instrument
          </motion.p>
          <motion.p className={styles.lede} variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
            A field record and calculation instrument for local floodplain
            officials: document flood damage, compute the FEMA 50%
            substantial-damage ratio, and issue the resulting determination.
          </motion.p>

          <motion.ul
            className={styles.factList}
            variants={{ visible: { transition: STAGGER_GROUP_TRANSITION } }}
          >
            {FACTS.map((fact) => (
              <motion.li key={fact.label} className={styles.factItem} variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
                <span className={styles.factLabel}>{fact.label}</span>
                <span>{fact.value}</span>
              </motion.li>
            ))}
          </motion.ul>

          <motion.div variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
            <Link href="/login" className={styles.signInButton}>
              Sign in
            </Link>
          </motion.div>

          <motion.p className={styles.footNote} variants={ENTRANCE_VARIANTS} transition={ENTRANCE_TRANSITION}>
            Determinations issued through this tool carry legal consequences
            under your jurisdiction&apos;s floodplain management ordinance.
          </motion.p>
        </motion.div>
      </div>
    </main>
  );
}
