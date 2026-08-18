import { expect, test } from "@playwright/test";

// W3 security hardening: proves the headers middleware.ts sets are actually
// present on real responses from the real dev server (root suite —
// baseURL-relative, runs against `pnpm dev` / riverline_dev like every
// other spec in this config, per playwright.config.ts).
//
// Two things this task's brief also asked this file to assert are instead
// covered elsewhere, documented here so the coverage is traceable rather
// than silently missing:
//   - "dev magic-link 404s when NODE_ENV=production": covered at unit level
//     in test/unit/security/dev-magic-link-gate.test.ts, per this task's own
//     documented fallback (spawning a full production build inside this
//     spec would need its own dedicated gate, like
//     playwright.determination.config.ts, to avoid disturbing the root
//     suite's riverline_dev assumptions — out of scope for a single spec
//     file). A manual production build+start pass was also run once by hand
//     confirming the real HTTP 404; see docs/security-review.md "Dev
//     magic-link gate".
//   - "cross-tenant photo fetch 403/404s": covered at the database/RLS
//     level in test/unit/security/photo-idor.test.ts, which exercises the
//     EXACT query app/api/photos/[id]/route.ts runs against two real
//     jurisdictions in riverline_test — the same "T-C1's RLS test fixtures"
//     pattern this task's brief points at. The root e2e suite's
//     riverline_dev only ever has one seeded jurisdiction (AGENTS.md rule 6
//     forbids seeding a second one there just for this test), so a real
//     two-tenant HTTP round trip isn't possible without a dedicated gate;
//     see docs/security-review.md "IDOR probe" for the full reasoning.

test.describe("security headers", () => {
  test("are present on a normal page response (/)", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    expect(headers["permissions-policy"]).toContain("geolocation=(self)");

    const csp = headers["content-security-policy"];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("strict-dynamic");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("worker-src 'self'");
    // No 'unsafe-inline' anywhere in the policy — the nonce is the whole point.
    expect(csp).not.toContain("unsafe-inline");
  });

  test("are present on an API route response, including for an unauthenticated 401", async ({ request }) => {
    const response = await request.get("/api/registry/search?q=test");
    // Unauthenticated — proves headers apply regardless of the auth
    // outcome, not just on the "happy path" page render.
    expect(response.status()).toBe(401);

    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["content-security-policy"]).toBeTruthy();
  });

  test("dev mode does not set HSTS (only meaningful over real HTTPS in production)", async ({ request }) => {
    const response = await request.get("/");
    // The root e2e suite always runs against `pnpm dev` (NODE_ENV=development).
    expect(response.headers()["strict-transport-security"]).toBeUndefined();
  });

  test("each page load gets a fresh CSP nonce (never reused across requests)", async ({ request }) => {
    const first = await request.get("/");
    const second = await request.get("/");
    const nonceOf = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
    const nonce1 = nonceOf(first.headers()["content-security-policy"]);
    const nonce2 = nonceOf(second.headers()["content-security-policy"]);
    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });
});
