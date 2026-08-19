"use client";

// Assessor home: "My queued assessments" (offline queue state surfaced).
// The offline queue only exists client-side (IndexedDB, src/core/capture/
// db.ts) — a server component can never read it, so this is deliberately a
// small client island inside the otherwise-server-rendered /home page.
// Reuses the real queue reader (getQueuedDrafts) from src/core/capture's
// public entry point — the same function app/AppShell.tsx's sync indicator
// and app/capture/[id]/CaptureFlow.tsx's own OfflineBanner both already
// drive. No sync logic is re-implemented here; this is read-only ("what's
// waiting"), not a sync trigger.
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { getQueuedDrafts } from "@/core/capture";
import type { CaptureDraft } from "@/core/capture";
import { ENTRANCE_VARIANTS, ENTRANCE_TRANSITION, STAGGER_GROUP_TRANSITION, useEntranceInitial } from "@/shared/ui";
import styles from "./page.module.css";

type LoadState = "loading" | "ready" | "error";

function syncLabel(status: CaptureDraft["syncStatus"]): string {
  if (status === "error") return "Sync failed — will retry";
  if (status === "syncing") return "Syncing…";
  return "Queued to sync";
}

function syncBadgeClass(status: CaptureDraft["syncStatus"]): string {
  if (status === "error") return styles.syncBadgeError as string;
  if (status === "syncing") return styles.syncBadgeSyncing as string;
  return styles.syncBadgeQueued as string;
}

export function QueuedAssessments() {
  const [state, setState] = useState<LoadState>("loading");
  const [drafts, setDrafts] = useState<CaptureDraft[]>([]);
  // Called unconditionally (React rules of hooks) even though it's only
  // used by the "ready, non-empty" render path below.
  const initial = useEntranceInitial();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const queued = await getQueuedDrafts();
        if (!cancelled) {
          setDrafts(queued);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div className={styles.statePanel} role="status">
        <p className={styles.statePanelText}>Checking this device for queued assessments…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={styles.errorPanel} role="alert">
        <p className={styles.statePanelText}>
          Could not read the offline queue on this device. Try reloading the page.
        </p>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className={styles.statePanel}>
        <p className={styles.statePanelText}>
          No assessments queued on this device. A completed assessment lists
          here until it finishes syncing.
        </p>
      </div>
    );
  }

  return (
    <motion.ul
      className={styles.queuedList}
      initial={initial}
      animate="visible"
      variants={{ visible: { transition: STAGGER_GROUP_TRANSITION } }}
    >
      {drafts.map((draft) => (
        <motion.li
          key={draft.clientId}
          className={styles.queuedItem}
          variants={ENTRANCE_VARIANTS}
          transition={ENTRANCE_TRANSITION}
        >
          <Link href={`/capture/${encodeURIComponent(draft.structureId)}`} className={styles.queuedLink}>
            <div className={styles.queuedMain}>
              <span className={styles.queuedStructure}>Structure {draft.structureId.slice(0, 8)}</span>
              <span className={styles.queuedMeta}>
                Completed{" "}
                {draft.completedAt ? new Date(draft.completedAt).toLocaleString("en-US") : "—"}
              </span>
            </div>
            <span className={syncBadgeClass(draft.syncStatus)}>
              <span className={styles.statusDot} aria-hidden="true" />
              {syncLabel(draft.syncStatus)}
            </span>
          </Link>
        </motion.li>
      ))}
    </motion.ul>
  );
}
