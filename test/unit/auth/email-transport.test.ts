import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMagicLinkEmailHtml,
  buildMagicLinkEmailText,
  buildPostmarkPayload,
  resolveEmailDriver,
  sendMagicLinkEmail,
} from "../../../src/core/auth/email-transport";
import { getDevMagicLink } from "../../../src/core/auth/dev-link-store";

// Snapshot every env var this module reads, so each test starts from a
// known-clean slate and no test can leak configuration into another —
// EMAIL_DRIVER/EMAIL_API_URL/EMAIL_API_KEY/EMAIL_FROM/APP_BASE_URL/NODE_ENV.
const ENV_KEYS = [
  "EMAIL_DRIVER",
  "EMAIL_API_URL",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "APP_BASE_URL",
  "NODE_ENV",
] as const;

let savedEnv: Record<string, string | undefined>;

// next's global type augmentation declares NODE_ENV as `readonly` on
// NodeJS.ProcessEnv, which correctly blocks accidental production-env
// mutation in app code — but this suite legitimately needs to flip it
// between "test" and "production" to exercise both branches. Routing the
// mutation through a differently-typed reference is the same pattern
// TypeScript itself suggests (cast, don't silence): it only defeats the
// *type-level* guard, never a runtime one, and only inside this test file.
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
function setNodeEnv(value: "test" | "production"): void {
  mutableEnv.NODE_ENV = value;
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  // Vitest's own default — restored explicitly so "unset EMAIL_DRIVER"
  // tests exercise the real non-production default this codebase runs
  // under everywhere except a real prod deploy.
  setNodeEnv("test");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

describe("resolveEmailDriver", () => {
  it("defaults to dev outside production", () => {
    expect(resolveEmailDriver()).toBe("dev");
  });

  it("defaults to none in production when unset", () => {
    setNodeEnv("production");
    expect(resolveEmailDriver()).toBe("none");
  });

  it("honors an explicit EMAIL_DRIVER=http", () => {
    process.env.EMAIL_DRIVER = "http";
    expect(resolveEmailDriver()).toBe("http");
  });

  it("honors an explicit EMAIL_DRIVER=none outside production", () => {
    process.env.EMAIL_DRIVER = "none";
    expect(resolveEmailDriver()).toBe("none");
  });

  it("rejects an unknown EMAIL_DRIVER value", () => {
    process.env.EMAIL_DRIVER = "smtp-relay";
    expect(() => resolveEmailDriver()).toThrow(/Unknown EMAIL_DRIVER/);
  });

  it("refuses EMAIL_DRIVER=dev in production, even if explicitly set", () => {
    setNodeEnv("production");
    process.env.EMAIL_DRIVER = "dev";
    expect(() => resolveEmailDriver()).toThrow(/not allowed when NODE_ENV=production/);
  });
});

describe("email content", () => {
  const url = "https://example.gov/api/auth/verify?token=abc123";

  it("text body includes the link, a 15-minute expiry note, and the ignore line", () => {
    const text = buildMagicLinkEmailText(url);
    expect(text).toContain(url);
    expect(text).toContain("15 minutes");
    expect(text).toContain("If you did not request this, ignore this email.");
    expect(text).toContain("RiverLine");
  });

  it("html body escapes the URL and carries the same substantive content, no images/tracking", () => {
    const html = buildMagicLinkEmailHtml(url);
    expect(html).toContain(url);
    expect(html).toContain("15 minutes");
    expect(html).toContain("If you did not request this, ignore this email.");
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/tracking|pixel|utm_/i);
  });

  it("html body HTML-escapes a URL containing special characters", () => {
    const dangerousUrl = 'https://example.gov/verify?token=a&b="x"<y>';
    const html = buildMagicLinkEmailHtml(dangerousUrl);
    expect(html).not.toContain('token=a&b="x"<y>');
    expect(html).toContain("token=a&amp;b=&quot;x&quot;&lt;y&gt;");
  });
});

describe("buildPostmarkPayload — exact JSON for fixed inputs", () => {
  it("produces the exact Postmark send-email shape", () => {
    const payload = buildPostmarkPayload({
      to: "official@example.gov",
      from: "no-reply@riverline.example.gov",
      verifyUrl: "https://riverline.example.gov/api/auth/verify?token=xyz",
    });

    expect(payload).toEqual({
      From: "no-reply@riverline.example.gov",
      To: "official@example.gov",
      Subject: "RiverLine sign-in link",
      TextBody: buildMagicLinkEmailText("https://riverline.example.gov/api/auth/verify?token=xyz"),
      HtmlBody: buildMagicLinkEmailHtml("https://riverline.example.gov/api/auth/verify?token=xyz"),
      MessageStream: "outbound",
    });
    // MessageStream must be Postmark's transactional stream, never the
    // broadcast one (docs/adr/0009-email-transport.md) — pinned explicitly
    // in case a future edit accidentally parameterizes this.
    expect(payload.MessageStream).toBe("outbound");
  });
});

describe("sendMagicLinkEmail — dev driver", () => {
  it("logs the link and stashes it in the dev-link store, unchanged from pre-existing behavior", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const email = `dev-driver-test-${Math.random()}@example.gov`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await sendMagicLinkEmail({
      email,
      verifyPath: "/api/auth/verify?token=devtoken123",
      expiresAt,
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[dev-auth] magic link for ${email}: /api/auth/verify?token=devtoken123`),
    );

    const stashed = getDevMagicLink(email);
    expect(stashed).not.toBeNull();
    expect(stashed?.url).toBe("/api/auth/verify?token=devtoken123");

    logSpy.mockRestore();
  });
});

describe("sendMagicLinkEmail — none driver", () => {
  it("throws loudly when unconfigured in production (default)", async () => {
    setNodeEnv("production");
    await expect(
      sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=abc",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/Production email transport is not configured/);
  });

  it("throws loudly when EMAIL_DRIVER=none is set explicitly outside production", async () => {
    process.env.EMAIL_DRIVER = "none";
    await expect(
      sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=abc",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/Production email transport is not configured/);
  });

  it("never silently no-ops — an unconfigured production send always rejects", async () => {
    setNodeEnv("production");
    let threw = false;
    try {
      await sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=abc",
        expiresAt: new Date(),
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("sendMagicLinkEmail — http driver", () => {
  function configureHttpEnv() {
    process.env.EMAIL_DRIVER = "http";
    process.env.EMAIL_API_URL = "https://api.postmarkapp.com/email";
    process.env.EMAIL_API_KEY = "test-server-token";
    process.env.EMAIL_FROM = "no-reply@riverline.example.gov";
    process.env.APP_BASE_URL = "https://riverline.example.gov";
  }

  it("POSTs the exact Postmark payload to EMAIL_API_URL with the right headers", async () => {
    configureHttpEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ ErrorCode: 0, Message: "OK" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendMagicLinkEmail({
      email: "official@example.gov",
      verifyPath: "/api/auth/verify?token=realtoken",
      expiresAt: new Date(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called — asserted above, unreachable");
    const [url, init] = call;
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Postmark-Server-Token"]).toBe("test-server-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      From: "no-reply@riverline.example.gov",
      To: "official@example.gov",
      Subject: "RiverLine sign-in link",
      TextBody: buildMagicLinkEmailText("https://riverline.example.gov/api/auth/verify?token=realtoken"),
      HtmlBody: buildMagicLinkEmailHtml("https://riverline.example.gov/api/auth/verify?token=realtoken"),
      MessageStream: "outbound",
    });
  });

  it("rejects a non-https APP_BASE_URL in production", async () => {
    configureHttpEnv();
    setNodeEnv("production");
    process.env.APP_BASE_URL = "http://riverline.example.gov";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=realtoken",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when EMAIL_API_URL/EMAIL_API_KEY/EMAIL_FROM are missing", async () => {
    process.env.EMAIL_DRIVER = "http";
    process.env.APP_BASE_URL = "https://riverline.example.gov";
    // No EMAIL_API_URL/EMAIL_API_KEY/EMAIL_FROM set.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=realtoken",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/EMAIL_API_URL must be set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a non-2xx provider response as a thrown error, without leaking the token", async () => {
    configureHttpEnv();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ErrorCode: 300, Message: "Invalid 'From' address" }), { status: 422 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=realtoken",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/422/);

    // Real assertion of the security requirement: the thrown error's own
    // message never contains the raw verify path (which embeds the token).
    try {
      await sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=realtoken",
        expiresAt: new Date(),
      });
    } catch (err) {
      expect(String(err)).not.toContain("realtoken");
    }
  });

  it("wraps a network failure in a clear error", async () => {
    configureHttpEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(
      sendMagicLinkEmail({
        email: "official@example.gov",
        verifyPath: "/api/auth/verify?token=realtoken",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(/network error/);
  });
});

// Live send: only exercises the real network + real provider when a real
// API key is actually present. Never fabricated — if EMAIL_API_KEY (plus
// EMAIL_API_URL/EMAIL_FROM/EMAIL_LIVE_TEST_TO) aren't set, this visibly
// skips rather than pretending to have run. As of this task, no provider
// key has been supplied yet (docs/BLOCKERS.md B4), so this is expected to
// skip in this environment.
const hasLiveCreds = Boolean(
  process.env.EMAIL_API_KEY && process.env.EMAIL_API_URL && process.env.EMAIL_FROM,
);

describe.skipIf(!hasLiveCreds)("live send (real provider — only runs with real credentials)", () => {
  it("sends a real magic-link email via the configured provider", async () => {
    vi.unstubAllGlobals(); // ensure the real global fetch is used, not a stub from a prior test
    process.env.EMAIL_DRIVER = "http";
    process.env.APP_BASE_URL = process.env.APP_BASE_URL ?? "https://example.invalid";
    const to = process.env.EMAIL_LIVE_TEST_TO ?? process.env.EMAIL_FROM!;

    await expect(
      sendMagicLinkEmail({
        email: to,
        verifyPath: "/api/auth/verify?token=live-test-token",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      }),
    ).resolves.toBeUndefined();
  });
});

if (!hasLiveCreds) {
  console.log(
    "[email-transport.test] Skipping live send test — EMAIL_API_KEY/EMAIL_API_URL/EMAIL_FROM not set in env.",
  );
}
