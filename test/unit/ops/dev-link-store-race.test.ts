import { describe, expect, it, beforeEach } from "vitest";
import { getDevMagicLink, setDevMagicLink } from "../../../src/core/auth/dev-link-store";

// T-W4 loose end: mobile-safari e2e flake, first documented in T-C2/T-C3/T-C4
// journals. Root cause: src/core/auth/dev-link-store.ts held one "most
// recent" pending link per email. Playwright runs `fullyParallel` across the
// chromium and mobile-safari projects, and several spec files all issue a
// magic-link request for the same seeded demo email and then immediately
// fetch it back via the dev-only route. When two requests for the same email
// race, the second `setDevMagicLink` call used to overwrite the first
// entry — so two different callers' `getDevMagicLink` reads could return the
// SAME single-use token. Whichever test navigated second got a token that
// was already consumed and failed to reach an authenticated page.
//
// Fix: a per-email FIFO queue — every set() enqueues a new entry, every
// get() dequeues (and removes) the oldest one, so N concurrent
// request-then-fetch pairs for the same email always receive N distinct
// tokens, in any interleaving.
//
// This test exercises the store directly (no HTTP, no browser, no Next.js
// dev server) so it is fast and deterministic — the E2E projects are the
// integration-level proof, this is the unit-level one.

// NODE_ENV must not be "production" for the dev-only store to do anything —
// vitest's default test env already satisfies this, but assert it so a CI
// config change would fail loudly here instead of silently no-op'ing.
if (process.env.NODE_ENV === "production") {
  throw new Error("This suite requires NODE_ENV !== 'production' (dev-link-store is a no-op in production).");
}

describe("T-W4: dev-link-store — per-email FIFO queue (mobile-safari flake fix)", () => {
  const email = "race-test@example.gov";

  beforeEach(() => {
    // Drain any leftover entries from a previous test in this file so tests
    // don't bleed into each other via the shared globalThis store.
    while (getDevMagicLink(email)) {
      // drain
    }
  });

  it("two concurrent set() calls for the same email produce two distinct entries, not one overwritten one", () => {
    const soon = new Date(Date.now() + 60_000);
    setDevMagicLink(email, "/api/auth/verify?token=AAA", soon);
    setDevMagicLink(email, "/api/auth/verify?token=BBB", soon);

    const first = getDevMagicLink(email);
    const second = getDevMagicLink(email);

    expect(first?.url).toBe("/api/auth/verify?token=AAA");
    expect(second?.url).toBe("/api/auth/verify?token=BBB");
    // Both distinct — the pre-fix bug was these being equal (both AAA, or
    // both BBB) because the second set() clobbered the first before it was
    // read.
    expect(first?.url).not.toBe(second?.url);
  });

  it("N interleaved requesters for the same email each get a distinct, never-repeated token", () => {
    const soon = new Date(Date.now() + 60_000);
    const N = 25;

    // Simulate N "request-link" calls all landing before any "fetch the
    // link" call runs — the worst-case interleaving for a single-slot store.
    for (let i = 0; i < N; i++) {
      setDevMagicLink(email, `/api/auth/verify?token=T${i}`, soon);
    }

    const seen = new Set<string>();
    for (let i = 0; i < N; i++) {
      const entry = getDevMagicLink(email);
      expect(entry).not.toBeNull();
      expect(seen.has(entry!.url)).toBe(false); // never handed out twice
      seen.add(entry!.url);
    }
    expect(seen.size).toBe(N);

    // Queue is now empty for this email.
    expect(getDevMagicLink(email)).toBeNull();
  });

  it("dequeues in FIFO order (oldest pending request served first)", () => {
    const soon = new Date(Date.now() + 60_000);
    setDevMagicLink(email, "/api/auth/verify?token=first", soon);
    setDevMagicLink(email, "/api/auth/verify?token=second", soon);
    setDevMagicLink(email, "/api/auth/verify?token=third", soon);

    expect(getDevMagicLink(email)?.url).toBe("/api/auth/verify?token=first");
    expect(getDevMagicLink(email)?.url).toBe("/api/auth/verify?token=second");
    expect(getDevMagicLink(email)?.url).toBe("/api/auth/verify?token=third");
  });

  it("expired entries at the front of the queue are dropped, not handed out", () => {
    const past = new Date(Date.now() - 1000);
    const soon = new Date(Date.now() + 60_000);
    setDevMagicLink(email, "/api/auth/verify?token=expired", past);
    setDevMagicLink(email, "/api/auth/verify?token=valid", soon);

    const entry = getDevMagicLink(email);
    expect(entry?.url).toBe("/api/auth/verify?token=valid");
  });

  it("different emails never see each other's queued entries", () => {
    const soon = new Date(Date.now() + 60_000);
    const emailB = "race-test-b@example.gov";
    setDevMagicLink(email, "/api/auth/verify?token=for-a", soon);
    setDevMagicLink(emailB, "/api/auth/verify?token=for-b", soon);

    expect(getDevMagicLink(email)?.url).toBe("/api/auth/verify?token=for-a");
    expect(getDevMagicLink(emailB)?.url).toBe("/api/auth/verify?token=for-b");
    // Drain B so it doesn't leak into other test files sharing globalThis.
    expect(getDevMagicLink(emailB)).toBeNull();
  });
});
