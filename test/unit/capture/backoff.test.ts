import { describe, expect, it } from "vitest";
import { backoffDelayMs, nextAttempt, MAX_SYNC_ATTEMPTS } from "@/core/capture/backoff";

describe("sync retry/backoff policy (AGENTS.md rule 7)", () => {
  it("delay grows exponentially per attempt", () => {
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(2)).toBe(2000);
    expect(backoffDelayMs(3)).toBe(4000);
  });

  it("retries the first two failures, then gives up on the third (default max 3)", () => {
    const a1 = nextAttempt(1);
    expect(a1.shouldRetry).toBe(true);
    expect(a1.giveUp).toBe(false);

    const a2 = nextAttempt(2);
    expect(a2.shouldRetry).toBe(true);

    const a3 = nextAttempt(3);
    expect(a3.shouldRetry).toBe(false);
    expect(a3.giveUp).toBe(true);
    expect(a3.delayMs).toBe(0);
  });

  it("MAX_SYNC_ATTEMPTS is exactly 3, per task spec", () => {
    expect(MAX_SYNC_ATTEMPTS).toBe(3);
  });
});
