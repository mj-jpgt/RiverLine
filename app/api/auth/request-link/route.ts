import { NextResponse } from "next/server";
import { z } from "zod";
import { requestMagicLink } from "@/core/auth";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/shared/security/rate-limit";

const bodySchema = z.object({ email: z.string().trim().email() });

// Rate limits — see docs/security-review.md "Rate limiting" for the full
// rationale. Per-email: 5 requests / 15 min, matching the task brief's own
// worked example, adopted here as this route's documented choice (not an
// invented "industry standard" figure) — magic links are also logged
// server-side (dev) and this is the account-takeover-adjacent surface
// (anyone who can trigger unlimited links at an email can spam that inbox).
// Per-IP: 20 requests / 15 min, looser than per-email because a
// jurisdiction office is plausibly several staff behind one NAT IP; this
// exists to blunt one IP enumerating many different emails, not to gate
// normal shared-network use.
// Test-harness override (integration finding 2026-08-17): the e2e gate
// suites legitimately log in ~10 times per seeded email inside one window,
// which the production default correctly blocks. AUTH_RATE_LIMIT_EMAIL /
// AUTH_RATE_LIMIT_IP raise the caps for those runs (set by scripts/test-*.mjs
// against dev/test servers only). Unset or invalid → production defaults.
// Never set these in a production deployment (docs/security-review.md).
function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const EMAIL_LIMIT = envLimit("AUTH_RATE_LIMIT_EMAIL", 5);
const IP_LIMIT = envLimit("AUTH_RATE_LIMIT_IP", 20);
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  const emailCheck = checkRateLimit(`request-link:email:${parsed.data.email}`, EMAIL_LIMIT, WINDOW_MS);
  if (!emailCheck.allowed) {
    return rateLimitResponse(emailCheck, "Too many sign-in requests for this email. Try again later.");
  }
  const ipCheck = checkRateLimit(`request-link:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  if (!ipCheck.allowed) {
    return rateLimitResponse(ipCheck, "Too many sign-in requests from this network. Try again later.");
  }

  try {
    await requestMagicLink(parsed.data.email);
  } catch (err) {
    console.error("[auth] request-link failed:", err);
    return NextResponse.json(
      { error: "Could not process the request right now. Try again shortly." },
      { status: 500 },
    );
  }

  // Same response whether or not the email is on the roster — do not leak
  // allowlist membership.
  return NextResponse.json({ requested: true });
}
