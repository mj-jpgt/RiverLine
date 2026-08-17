// Foreground-only sync, per docs/adr/0002-offline-and-pwa.md decision #3:
// iOS Safari does not implement Background Sync at all, so this deliberately
// never registers a `sync` event. Triggers instead: on completion, on the
// browser's `online` event, on `visibilitychange` (app reopened/foregrounded),
// and a visible manual "Sync now" button (registerSyncTriggers wires the
// first three; the button calls syncOne/syncAll directly).
//
// Retry/backoff is implemented via a persisted `lastAttemptAt` timestamp
// compared against the current time, NOT a scheduled setTimeout chain. Two
// reasons: (1) a backgrounded/suspended mobile browser tab cannot be
// trusted to run a timer on schedule anyway — foreground triggers (online,
// visibilitychange, a manual tap) are already this module's real retry
// mechanism per ADR 0002, so a timer-based auto-retry queue was redundant
// capability; (2) real testing in this session surfaced environment cases
// where a setTimeout scheduled deep inside a retry chain's own promise
// continuation did not reliably fire, which would silently stall the whole
// queue in "syncing" with no way to recover. A timestamp comparison has no
// such failure mode — every call to syncOne() is a fresh, independent
// attempt that can never get permanently stuck.
"use client";

import { getQueuedDrafts, markSyncAttempt, markSynced } from "./db";
import { backoffDelayMs, MAX_SYNC_ATTEMPTS } from "./backoff";
import { buildSyncPayload } from "./payload";
import type { CaptureDraft } from "./types";

const SYNC_ENDPOINT = "/api/capture/sync";
// A field connection can stall a TCP connection indefinitely (captive
// portal, dead Wi-Fi association that hasn't timed out yet) — fetch() alone
// has no default timeout and would hang a single attempt forever, which is
// exactly the silent-failure AGENTS.md rule 7 forbids. Bound every attempt
// explicitly.
const FETCH_TIMEOUT_MS = 15000;

export interface SyncResult {
  clientId: string;
  ok: boolean;
  /** true once syncAttempts has reached MAX_SYNC_ATTEMPTS — automatic
   * (non-forced) triggers stop attempting past this point; a manual
   * "Sync now" tap always ignores it and tries again (which also resets
   * the counter on success). */
  gaveUp: boolean;
  error: string | null;
}

// Two triggers can fire close together (e.g. the 'online' event and a
// manual "Sync now" tap landing in the same moment) — without de-duping, a
// second concurrent attempt for the same draft could race the first one's
// markSyncAttempt writes. One in-flight attempt per clientId at a time; a
// trigger that arrives mid-attempt is a harmless no-op.
const inFlight = new Set<string>();

async function postPayload(draft: CaptureDraft): Promise<{ ok: boolean; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const payload = await buildSyncPayload(draft);
    const res = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `Sync failed (HTTP ${res.status}).` };
    }
    return { ok: true, error: null };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    // Log the raw browser error for developer diagnosis (never silent per
    // AGENTS.md rule 7) while keeping the user-facing message plain — a
    // field assessor doesn't need "TypeError: Failed to fetch", they need
    // to know to check their connection and that retry is automatic/manual.
    console.error("[capture] sync fetch failed:", err);
    return {
      ok: false,
      error: timedOut
        ? "Sync timed out. Check your connection."
        : "Network error while syncing. Check your connection.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function cooldownElapsed(draft: CaptureDraft): boolean {
  if (!draft.lastAttemptAt) return true;
  const attempt = Math.max(draft.syncAttempts, 1);
  const elapsed = Date.now() - new Date(draft.lastAttemptAt).getTime();
  return elapsed >= backoffDelayMs(attempt);
}

/**
 * Attempts to sync a single draft, exactly once. No empty-catch anywhere on
 * this path (AGENTS.md rule 7): every failure sets a visible lastSyncError
 * on the draft. `force: true` (the manual "Sync now" control) always
 * attempts immediately; automatic triggers (online/visibilitychange)
 * respect the backoff cooldown computed from syncAttempts/lastAttemptAt so
 * a flaky connection doesn't hammer the endpoint on every trigger.
 */
export async function syncOne(draft: CaptureDraft, options: { force?: boolean } = {}): Promise<SyncResult> {
  const force = options.force ?? false;

  if (inFlight.has(draft.clientId)) {
    return { clientId: draft.clientId, ok: false, gaveUp: false, error: null };
  }
  if (!force && !cooldownElapsed(draft)) {
    return { clientId: draft.clientId, ok: false, gaveUp: false, error: draft.lastSyncError };
  }

  inFlight.add(draft.clientId);
  try {
    await markSyncAttempt(draft.clientId, "syncing", null);
    const { ok, error } = await postPayload(draft);

    if (ok) {
      await markSynced(draft.clientId);
      return { clientId: draft.clientId, ok: true, gaveUp: false, error: null };
    }

    await markSyncAttempt(draft.clientId, "error", error);
    const attemptNumber = draft.syncAttempts + 1;
    return { clientId: draft.clientId, ok: false, gaveUp: attemptNumber >= MAX_SYNC_ATTEMPTS, error };
  } finally {
    inFlight.delete(draft.clientId);
  }
}

export async function syncAllQueued(options: { force?: boolean } = {}): Promise<SyncResult[]> {
  const queued = await getQueuedDrafts();
  const results: SyncResult[] = [];
  // Sequential, not Promise.all: keeps the transaction load on the sync
  // endpoint predictable on a field device's weak connection, and keeps
  // "N assessments queued" a stable, non-flickering count while syncing.
  for (const draft of queued) {
    results.push(await syncOne(draft, options));
  }
  return results;
}

/** Wires the two foreground triggers ADR 0002 requires in place of
 * Background Sync: the `online` event and `visibilitychange` (covers
 * "reopened the app" / "brought to foreground"). Returns an unsubscribe
 * function for cleanup in a React effect. */
export function registerSyncTriggers(onSync: () => void): () => void {
  function handleOnline() {
    onSync();
  }
  function handleVisibility() {
    if (document.visibilityState === "visible" && navigator.onLine) {
      onSync();
    }
  }
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
