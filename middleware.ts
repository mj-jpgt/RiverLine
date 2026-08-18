// Root Next.js middleware: security response headers on every request this
// app serves. See docs/security-review.md "Headers" for the full audit —
// this file is deliberately just header-setting, no auth/rate-limit logic
// (those stay in the route handlers themselves, per this task's own scope
// note: rate limiting needs node:crypto-backed in-memory state, and
// middleware here runs the Edge runtime by default, which this project does
// not otherwise depend on — keeping it out of middleware avoids introducing
// an Edge-runtime dependency for no benefit).
//
// CSP: nonce + 'strict-dynamic', per the official Next.js guide
// (https://nextjs.org/docs/app/guides/content-security-policy, retrieved
// 2026-08-17) — this is the documented alternative to 'unsafe-inline' for
// script-src. Nonce-based CSP requires every page to be dynamically
// rendered (same doc); this app already is: every page under app/ calls
// verifySessionCookie()/cookies() as its first step for the auth guard
// (grepped app/**/page.tsx to confirm), which already forces dynamic
// rendering, so switching to nonce-based CSP costs nothing here — verified,
// not assumed.
import { NextResponse, type NextRequest } from "next/server";

// app/letters/[clientId]/print/route.ts returns a hand-built HTML string
// (src/modules/a1-letters/pure.ts renderLetterHtml) directly as a Response
// — it is NOT rendered through React/Next's SSR pipeline, so the automatic
// nonce injection this file otherwise relies on never touches it. That
// document embeds a real inline <style> block and one inline
// onclick="window.print()" handler (the print-first letter template is
// deliberately a single self-contained document per docs/adr/0006, so it
// stays byte-identical whether opened in the app shell or reopened months
// later as the archived record — it does not depend on the app's own
// nonce plumbing at all). Caught by manually testing this exact route
// under the strict policy below (both would have been silently blocked,
// breaking the print button and all letter styling) — "test, don't guess"
// paid for itself here. Fix: this one route gets a narrower, explicitly
// documented 'unsafe-inline' exception instead of the nonce policy; every
// other route keeps the strict one. All letter content is escapeHtml()'d
// from DB facts before interpolation (src/modules/a1-letters/pure.ts), so
// this is a low-risk, narrowly-scoped relaxation, not a blanket one.
const LETTER_PRINT_PATH = /^\/letters\/[^/]+\/print$/;

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const isLetterPrint = LETTER_PRINT_PATH.test(request.nextUrl.pathname);

  if (isLetterPrint) {
    const response = NextResponse.next();
    const letterCsp = [
      "default-src 'self'",
      // The one documented 'unsafe-inline' in this codebase's CSP — see the
      // comment above LETTER_PRINT_PATH for why this single route needs it
      // and why it's still narrowly scoped (no 'unsafe-eval', no relaxed
      // img/connect/frame directives, object-src still none).
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; ");
    response.headers.set("Content-Security-Policy", letterCsp);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(self), geolocation=(self)");
    if (!isDev) {
      response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    return response;
  }

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' only in dev: React's dev-mode error-stack reconstruction
    // needs it (Next.js's own documented reason, same doc as above); never
    // shipped in production. No 'unsafe-inline' anywhere in script-src —
    // this codebase has no inline <script> or onClick="" HTML, only
    // React-bundled JS, which the nonce + strict-dynamic covers.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // No style-src 'unsafe-inline' kept either: AGENTS.md's UI rules forbid
    // inline styles/arbitrary values codebase-wide, and grepping app/ for
    // style={{ or dangerouslySetInnerHTML found zero matches (verified
    // 2026-08-17) — there is nothing here that needs it. The nonce covers
    // any <style> tag Next.js itself manages.
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    // The Serwist service worker is fetched via the Service Worker API
    // (navigator.serviceWorker.register), not a <script> tag — governed by
    // worker-src, not script-src. Declared explicitly rather than relying
    // on the script-src fallback: 'strict-dynamic' changes fallback
    // behavior for directives that inherit from script-src in some browser
    // implementations, and this is exactly the "test, don't guess" surface
    // docs/adr/0002 warns about — explicit beats implicit here. (public/sw.js
    // itself is excluded from this middleware's matcher below, so the
    // worker's own execution context is unaffected by this CSP entirely;
    // this directive only governs whether the *page* may register it.)
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // 'self', not 'none': app/letters/[clientId]/page.tsx iframes its own
    // same-origin /letters/[clientId]/print route for the letter preview
    // (verified by reading that file). frame-ancestors 'none' would break
    // that real feature — this is the one documented deviation from a
    // literal reading of "frame-ancestors DENY" in the task brief; see
    // docs/security-review.md "Headers" for the same note against
    // X-Frame-Options below.
    "frame-ancestors 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  // SAMEORIGIN, not DENY — see the frame-ancestors comment above; this is
  // the legacy header doing the same same-origin-only job for browsers that
  // don't honor frame-ancestors.
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // camera=(self), geolocation=(self): the capture flow (build spec §6.1)
  // needs both, on this origin, and nothing else needs either — every other
  // feature and every other origin is denied by omission (Permissions-
  // Policy's default is deny-all for anything not listed).
  response.headers.set("Permissions-Policy", "camera=(self), geolocation=(self)");

  if (!isDev) {
    // HSTS is only meaningful once TLS actually terminates correctly in
    // front of this app. Production deploy (Caddy on a VPS, or a platform
    // proxy) is W4's territory (docs/deploy/) — this header states the
    // policy the app wants; whether it's honored depends on the proxy
    // actually forwarding it and terminating HTTPS, which needs to be
    // confirmed at deploy time, not assumed here. See
    // docs/security-review.md "HSTS / proxy interplay".
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  return response;
}

export const config = {
  matcher: [
    {
      // Excludes: Next's own static/image-optimization internals (no
      // security-relevant content, and re-running this on every chunk
      // request is pure overhead), and public/sw.js / manifest.webmanifest
      // specifically — the service worker's own execution context should
      // not inherit this page-oriented CSP (see the worker-src comment
      // above), and the manifest is static, unauthenticated, non-sensitive
      // JSON with nothing here to protect.
      source: "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
