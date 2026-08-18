import styles from "./nav.module.css";

// Compact, header-level variant of the same offline/sync semantics
// app/capture/[id]/_components/OfflineBanner.tsx implements for the capture
// flow — deliberately NOT the same file (src/shared/** may not import
// app/capture internals, and the capture flow's own banner stays there so
// it keeps full control of its one-decision-per-screen surface). This one
// is fed real sync state computed in app/AppShell.tsx from
// src/core/capture's actual queue/sync functions (getQueuedDrafts,
// syncAllQueued, registerSyncTriggers) — never re-implemented here, purely
// presentational. Persistent banner, never a toast (AGENTS.md rule 7).
export type ShellSyncStatus = "hidden" | "offline" | "syncing" | "error" | "synced";

export interface SyncStatusIndicatorProps {
  status: ShellSyncStatus;
  queuedCount: number;
  errorMessage: string | null;
  onSyncNow: () => void;
}

export function SyncStatusIndicator({ status, queuedCount, errorMessage, onSyncNow }: SyncStatusIndicatorProps) {
  if (status === "hidden") return null;

  const className =
    status === "offline"
      ? styles.syncOffline
      : status === "error"
        ? styles.syncError
        : status === "synced"
          ? styles.syncSynced
          : styles.syncSyncing;

  const plural = queuedCount === 1 ? "" : "s";

  const text =
    status === "offline"
      ? queuedCount > 0
        ? `Offline — ${queuedCount} assessment${plural} queued`
        : "Offline"
      : status === "syncing"
        ? `Syncing ${queuedCount} assessment${plural}…`
        : status === "error"
          ? (errorMessage ?? `${queuedCount} assessment${plural} waiting to sync`)
          : "Synced";

  const showButton = status === "offline" || status === "error";

  return (
    <div className={className} role="status" aria-live="polite">
      <p className={styles.syncText}>{text}</p>
      {showButton ? (
        <button type="button" className={styles.syncButton} onClick={onSyncNow}>
          Sync now
        </button>
      ) : null}
    </div>
  );
}
