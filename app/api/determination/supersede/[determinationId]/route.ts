import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { supersedeDetermination } from "../../../../determination/_lib/actions";

// Supersede an adopted determination: the old row's status becomes
// 'superseded' (never deleted — schema/core.sql's forbid_delete trigger
// would reject a DELETE outright, AGENTS.md rule 11) and a new `draft`
// determination is created pointing at a freshly computed calculation.
const bodySchema = z.object({ reason: z.string() });

const ERROR_MESSAGES: Record<string, string> = {
  reason_required: "A reason is required to supersede a determination.",
  not_found: "Determination not found.",
  not_adopted: "Only an adopted (or contested) determination can be superseded.",
  compute_failed: "Could not compute a fresh calculation for the new determination.",
};

export async function POST(request: Request, { params }: { params: Promise<{ determinationId: string }> }) {
  const { determinationId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const result = await supersedeDetermination(jurisdictionId, userId, determinationId, parsed.data.reason);

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error ?? ""] ?? "Could not supersede.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({ ok: true, newDeterminationId: result.newDeterminationId, newClientId: result.newClientId });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[determination] supersede failed:", err);
    return NextResponse.json({ error: "Could not supersede." }, { status: 500 });
  }
}
