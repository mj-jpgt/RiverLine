import { NextResponse } from "next/server";
import { verifyMagicLink, createSessionCookieValue, SESSION_COOKIE_NAME } from "@/core/auth";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/shared/security/rate-limit";

// Per-IP only (no email to key on until a token is looked up): tokens are
// 256-bit opaque values (src/core/auth/crypto.ts), not practically
// guessable, so this isn't a meaningful brute-force defense — it exists to
// bound wasted DB lookups and log noise from a malfunctioning or automated
// client retrying in a loop. 30/15min per IP is loose enough that a real
// user clicking a real link, including a stale/already-used one they retry,
// never hits it. See docs/security-review.md "Rate limiting".
const IP_LIMIT = 30;
const WINDOW_MS = 15 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  const ipCheck = checkRateLimit(`verify:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  if (!ipCheck.allowed) {
    return rateLimitResponse(ipCheck, "Too many verification attempts from this network. Try again later.");
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  const login = await verifyMagicLink(token);
  if (!login) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
  }

  const { value, maxAgeSeconds } = createSessionCookieValue(login);

  const response = NextResponse.redirect(new URL("/home", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    path: "/",
  });
  return response;
}
