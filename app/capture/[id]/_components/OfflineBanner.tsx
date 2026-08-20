"use client";

import { LoadingIndicator } from "@/shared/ui";
import styles from "../capture.module.css";

export type BannerState = "offline" | "syncing" | "error" | "synced" | "hidden";

interface OfflineBannerProps {
  state: BannerState;
  queuedCount: number;
  errorMessage: string | null;
  onSyncNow: () => void;
  /** F2: when a photo upload is actively in flight, show real progress
   * instead of a generic "syncing" message — same photoProgress state that
   * drives the complete screen's subheading (CaptureFlow.tsx), so this
   * banner and that screen never tell two different stories at once. */
  photoProgress?: { uploaded: number; total: number } | null;
}

// Persistent, never a toast (AGENTS.md rule 7; components.md "Offline
// banner" row; ui-review-checklist.md Part A #7). Calm, not alarming
// (direction.md "Smooth, not decorative" #3) — syncing/synced use neutral or
// success color, only a real error uses --color-danger.
export function OfflineBanner({ state, queuedCount, errorMessage, onSyncNow, photoProgress }: OfflineBannerProps) {
  if (state === "hidden") return null;

  const className =
    state === "offline"
      ? styles.bannerOffline
      : state === "error"
        ? styles.bannerError
        : state === "synced"
          ? styles.bannerSynced
          : styles.bannerSyncing;

  const uploadingPhotos = photoProgress && photoProgress.uploaded < photoProgress.total;

  const text =
    state === "offline"
      ? `Offline. ${queuedCount} assessment${queuedCount === 1 ? "" : "s"} queued.`
      : state === "syncing"
        ? uploadingPhotos
          ? `Uploading photo ${photoProgress.uploaded + 1} of ${photoProgress.total}.`
          : `Syncing ${queuedCount} assessment${queuedCount === 1 ? "" : "s"}.`
        : state === "error"
          ? (errorMessage ?? "Sync failed. It will stay queued until you retry.")
          : "Synced";

  const showSyncButton = state === "offline" || state === "error";

  return (
    <div className={className} role="status" aria-live="polite">
      <p className={styles.bannerText}>{text}</p>
      {state === "syncing" ? <LoadingIndicator /> : null}
      {showSyncButton ? (
        <button type="button" className={styles.syncNowButton} onClick={onSyncNow}>
          Sync now
        </button>
      ) : null}
    </div>
  );
}
