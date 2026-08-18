import { describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, rateLimitResponse } from "../../../src/shared/security/rate-limit";

// Pure logic, no DB, no mocks needed — the limiter's own in-memory Map is
// the thing under test, keyed uniquely per test via random keys so tests
// never share a bucket with each other (globalThis-backed store persists
// across the whole vitest run).

describe("checkRateLimit", () => {
  it("allows up to the limit, then rejects", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const result = checkRateLimit(key, 3, 60_000);
      expect(result.allowed).toBe(true);
    }
    const fourth = checkRateLimit(key, 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks remaining hits accurately within the window", () => {
    const key = `test-${Math.random()}`;
    const first = checkRateLimit(key, 5, 60_000);
    expect(first.remaining).toBe(4);
    const second = checkRateLimit(key, 5, 60_000);
    expect(second.remaining).toBe(3);
  });

  it("keeps separate keys independent", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(keyA, 5, 60_000);
    const aRejected = checkRateLimit(keyA, 5, 60_000);
    const bAllowed = checkRateLimit(keyB, 5, 60_000);
    expect(aRejected.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
  });

  it("lets a caller back in once the window has fully elapsed", () => {
    const key = `test-${Math.random()}`;
    // A window so short it has already elapsed by the second call, without
    // needing a real sleep in the test.
    const result1 = checkRateLimit(key, 1, 1);
    expect(result1.allowed).toBe(true);
    // Busy-wait a couple ms in real time — the window is 1ms, this always clears it.
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin briefly */
    }
    const result2 = checkRateLimit(key, 1, 1);
    expect(result2.allowed).toBe(true);
  });

  it("rejects further hits within the window even across many rapid calls", () => {
    const key = `test-${Math.random()}`;
    const limit = 10;
    let rejectedCount = 0;
    for (let i = 0; i < 25; i++) {
      const result = checkRateLimit(key, limit, 60_000);
      if (!result.allowed) rejectedCount++;
    }
    expect(rejectedCount).toBe(15);
  });
});

describe("clientIp", () => {
  it("uses the first hop of X-Forwarded-For", () => {
    const req = new Request("http://example.test", {
      headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" },
    });
    expect(clientIp(req)).toBe("203.0.113.5");
  });

  it("falls back to X-Real-IP", () => {
    const req = new Request("http://example.test", { headers: { "x-real-ip": "198.51.100.7" } });
    expect(clientIp(req)).toBe("198.51.100.7");
  });

  it("falls back to a constant when neither header is present", () => {
    const req = new Request("http://example.test");
    expect(clientIp(req)).toBe("unknown");
  });
});

describe("rateLimitResponse", () => {
  it("returns a 429 with a Retry-After header", async () => {
    const result = checkRateLimit(`test-${Math.random()}`, 0, 60_000);
    expect(result.allowed).toBe(false);
    const response = rateLimitResponse(result, "slow down");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(String(result.retryAfterSeconds));
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("slow down");
  });
});
