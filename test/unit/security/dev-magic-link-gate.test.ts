import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../app/api/dev/magic-link/route";

// app/api/dev/magic-link/route.ts is one of the two routes in this codebase
// with no cookies()/next-headers call (it only reads process.env.NODE_ENV,
// a query param, and the dev-only in-memory store), so — unlike every
// session-guarded route (see test/unit/modules/a3/export-integration.test.ts's
// documented reason for NOT importing route.ts handlers directly) — it can
// be imported and exercised directly here. This is the "test the gate logic
// at unit level" fallback this task's brief explicitly allows in place of
// spawning a full production build for an e2e proof, given the 10-minute
// foreground-command cap. A real production build+start pass was also run
// manually (see docs/security-review.md "Dev magic-link gate") confirming
// GET /api/dev/magic-link 404s for real over HTTP with NODE_ENV=production
// — this test exists to keep that guarantee under CI regression coverage
// going forward, since the manual pass isn't repeatable in CI.

const ORIGINAL_ENV = process.env.NODE_ENV;

afterEach(() => {
  vi.stubEnv("NODE_ENV", ORIGINAL_ENV ?? "test");
});

describe("GET /api/dev/magic-link — production gate", () => {
  it("404s when NODE_ENV=production, even with a well-formed request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://localhost/api/dev/magic-link?email=assessor@example.gov");
    const response = await GET(request);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Not found.");
  });

  it("does not leak whether the dev store has a pending link when gated (no 200 path exists in production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://localhost/api/dev/magic-link?email=nonexistent@example.gov");
    const response = await GET(request);
    expect(response.status).toBe(404);
  });

  it("is reachable in non-production (dev/test) — the gate is production-specific, not a permanent bypass removal", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const request = new Request("http://localhost/api/dev/magic-link?email=nonexistent@example.gov");
    const response = await GET(request);
    // Reachable (not 404-by-env-gate) — resolves to "no pending link" 404
    // for an email with nothing queued, which is a different code path
    // (the store lookup, not the env gate) proven by the different message.
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("No pending magic link for that email.");
  });
});
