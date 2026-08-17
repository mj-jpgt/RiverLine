import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { issueLetter } from "@/modules/a1-letters";

// Issues a letter for an adopted, definite determination whose jurisdiction
// has a real ordinance citation on file. Role-guarded the same as
// determination adoption (admin/official only — never assessor/viewer).
const ERROR_MESSAGES: Record<string, string> = {
  not_ready: "This determination is not ready for a letter (not adopted, borderline, or missing a citation).",
  already_issued: "A letter has already been issued for this determination.",
};

export async function POST(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "official"]);

    const result = await issueLetter(jurisdictionId, userId, clientId);
    if (!result.ok) {
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error ?? ""] ?? "Could not issue this letter.", errorCode: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, letterId: result.letterId });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[letters] issue failed:", err);
    return NextResponse.json({ error: "Could not issue this letter." }, { status: 500 });
  }
}
