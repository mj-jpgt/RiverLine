import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireActiveRole, AuthError } from "@/core/auth";
import { generateSignInLink } from "@/core/admin";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/shared/security/rate-limit";

// T-G3: generates a single-use, admin-triggered sign-in link ON DEMAND —
// this makes team onboarding work TODAY without a configured email
// transport (docs/BLOCKERS.md B4). The admin gets a URL back to hand to
// the new team member over any channel; it authenticates through the
// exact same /api/auth/verify route a real magic link uses.
//
// Rate limits, reusing W3's limiter (src/shared/security/rate-limit.ts),
// same pattern app/api/auth/request-link/route.ts already establishes:
// per-actor (this admin) and per-IP, so a compromised or careless admin
// session can't be used to mint an unbounded number of working sign-in
// links. 10/15min per actor is generous for real onboarding (a manager
// adding a whole field crew in one sitting) while still bounding blast
// radius; 30/15min per IP mirrors app/api/auth/verify/route.ts's own IP
// limit for the same class of endpoint.
const ACTOR_LIMIT = 10;
const IP_LIMIT = 30;
const WINDOW_MS = 15 * 60 * 1000;

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
// Test-harness override, same shape as AUTH_RATE_LIMIT_EMAIL/IP
// (app/api/auth/request-link/route.ts) — the e2e gate for this feature
// legitimately generates several links per run. Never set in production.
const ACTOR_LIMIT_RESOLVED = envLimit("SIGN_IN_LINK_RATE_LIMIT_ACTOR", ACTOR_LIMIT);
const IP_LIMIT_RESOLVED = envLimit("SIGN_IN_LINK_RATE_LIMIT_IP", IP_LIMIT);

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "User not found.",
  user_deactivated: "This user is deactivated. Reactivate them first.",
};

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: targetUserId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = await requireActiveRole(session, ["admin"]);

    const actorCheck = checkRateLimit(`sign-in-link:actor:${userId}`, ACTOR_LIMIT_RESOLVED, WINDOW_MS);
    if (!actorCheck.allowed) {
      return rateLimitResponse(actorCheck, "Too many sign-in links generated. Try again later.");
    }
    const ipCheck = checkRateLimit(`sign-in-link:ip:${clientIp(request)}`, IP_LIMIT_RESOLVED, WINDOW_MS);
    if (!ipCheck.allowed) {
      return rateLimitResponse(ipCheck, "Too many sign-in links generated from this network. Try again later.");
    }

    const result = await generateSignInLink(jurisdictionId, userId, targetUserId);

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error] ?? "Could not generate a sign-in link.", errorCode: result.error },
        { status },
      );
    }

    // The verify path is relative — the client builds the absolute URL
    // from its own origin (window.location.origin), so this never needs
    // APP_BASE_URL (unlike the email transport's http driver) and works
    // identically on any deploy target.
    return NextResponse.json({ ok: true, verifyPath: result.verifyPath, expiresAtIso: result.expiresAtIso });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[admin] generate sign-in link failed:", err);
    return NextResponse.json({ error: "Could not generate a sign-in link." }, { status: 500 });
  }
}
