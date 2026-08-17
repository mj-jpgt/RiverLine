// Pure retry/backoff policy for the sync queue. AGENTS.md rule 7: "the sync
// queue has one error policy: retry with backoff, then surface visibly to
// the user. Silent failure is data loss." No background-sync event exists on
// iOS (docs/adr/0002-offline-and-pwa.md) so this only ever runs in the
// foreground — on completion, on 'online', on visibilitychange, or a manual
// "Sync now" tap (src/core/capture/sync.ts wires those triggers).

export const MAX_SYNC_ATTEMPTS = 3;

/** Exponential backoff in ms, attempt is 1-based (the Nth attempt that just
 * failed). Capped, jitter-free — deterministic and easy to test. */
export function backoffDelayMs(attempt: number): number {
  const base = 1000;
  const capped = Math.min(attempt, 6);
  return base * 2 ** (capped - 1);
}

export interface AttemptOutcome {
  attempt: number;
  shouldRetry: boolean;
  delayMs: number;
  giveUp: boolean;
}

/** Given the attempt number that just failed (1-based), decide whether to
 * retry (with what delay) or give up and surface a persistent visible
 * error — never an infinite silent retry loop, never a silent drop. */
export function nextAttempt(failedAttempt: number, maxAttempts = MAX_SYNC_ATTEMPTS): AttemptOutcome {
  const giveUp = failedAttempt >= maxAttempts;
  return {
    attempt: failedAttempt,
    shouldRetry: !giveUp,
    delayMs: giveUp ? 0 : backoffDelayMs(failedAttempt),
    giveUp,
  };
}
