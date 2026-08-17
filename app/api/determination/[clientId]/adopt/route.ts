import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { adoptDetermination } from "../../../../determination/_lib/actions";

// THE TOOL PROPOSES, THE OFFICIAL ADOPTS (AGENTS.md rule 12). This is the
// only code path anywhere in the codebase that can set
// determinations.status = 'adopted', and it requires:
//   1. role = official or admin (never assessor/viewer — proven by
//      test/e2e/determination.spec.ts's "adopt as assessor -> forbidden");
//   2. `confirmed: true` in the body, which only fires after the UI's
//      confirmation-dialog step (app/determination/[clientId]/_components/AdoptAction.tsx) —
//      never wired to a single tap.
// Never called automatically from a sync, a cron, or a page render.
const bodySchema = z.object({ confirmed: z.literal(true) });

const ERROR_MESSAGES: Record<string, string> = {
  confirmation_required: "Adoption requires explicit confirmation.",
  not_found: "Assessment not found.",
  no_calculation: "No calculation exists yet for this assessment — nothing to adopt.",
  already_adopted: "This determination has already been adopted. Use Supersede to issue a corrected one.",
};

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Adoption requires explicit confirmation." }, { status: 400 });
    }

    const result = await adoptDetermination(jurisdictionId, userId, clientId, parsed.data.confirmed);

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error ?? ""] ?? "Could not adopt.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({
      ok: true,
      determinationId: result.determinationId,
      appealDeadlineDate: result.appealDeadlineDate,
      appealWindowConfigured: result.appealWindowConfigured,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[determination] adopt failed:", err);
    return NextResponse.json({ error: "Could not adopt." }, { status: 500 });
  }
}
