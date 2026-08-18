import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { checkRateLimit, rateLimitResponse } from "@/shared/security/rate-limit";
import { confirmEstimate } from "@/modules/a4-estimates";

// Rate-limited for the same defense-in-depth reason the upload route is
// (docs/security-review.md's W3 audit, 2026-08-17) — looser than upload's
// limit since this route never touches a file, just a small JSON body.
const CONFIRM_LIMIT = 20;
const CONFIRM_WINDOW_MS = 60 * 1000;

// A4 estimate confirmation (spec §8, the heart of the mitigations): the
// ONLY route that can ever write confirmed_total / confirmed_line_items /
// scope_reviewed / confirmed_by_user_id / confirmed_at. Everything the
// client-side confirmation UI gates (all fields individually verified,
// total tapped not auto-picked, reconciliation checked, sanity bound
// checked, scope checkbox) is a client-side UX gate; the two facts this
// route CAN and DOES re-verify server-side — scope_reviewed truthy, and a
// finite positive confirmed_total — are enforced again here, never trusted
// from the client alone (same discipline
// app/api/determination/[clientId]/adopt/route.ts uses for `confirmed:
// true`).

const confirmedLineItemSchema = z.object({
  description: z.string().min(1),
  amountDollars: z.number(),
});

const bodySchema = z.object({
  confirmedTotal: z.number(),
  confirmedLineItems: z.array(confirmedLineItemSchema),
  scopeReviewed: z.boolean(),
  provenance: z.enum(["ocr_assisted", "manual_entry"]),
  notes: z.string().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ estimateId: string }> }) {
  const { estimateId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const confirmCheck = checkRateLimit(`estimates-confirm:user:${userId}`, CONFIRM_LIMIT, CONFIRM_WINDOW_MS);
    if (!confirmCheck.allowed) {
      return rateLimitResponse(confirmCheck, "Too many confirmation attempts. Try again shortly.");
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed confirmation payload.", issues: parsed.error.issues }, { status: 400 });
    }

    const result = await confirmEstimate(jurisdictionId, userId, estimateId, parsed.data);

    if (result.status === "not_found") {
      return NextResponse.json({ error: "No estimate found for that id." }, { status: 404 });
    }
    if (result.status === "already_confirmed") {
      return NextResponse.json(
        { error: "This estimate version is already confirmed. Upload a new version to correct it." },
        { status: 409 },
      );
    }
    if (result.status === "scope_not_reviewed") {
      return NextResponse.json(
        { error: 'The "reviewed for disaster-related scope only" checkbox is required.' },
        { status: 400 },
      );
    }
    if (result.status === "invalid_total") {
      return NextResponse.json({ error: "The confirmed total must be a positive amount." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[estimates] confirm failed:", err);
    return NextResponse.json({ error: "Could not save the confirmation. Please try again." }, { status: 500 });
  }
}
