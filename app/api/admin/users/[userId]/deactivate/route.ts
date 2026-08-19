import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireActiveRole, AuthError } from "@/core/auth";
import { deactivateUser } from "@/core/admin";

// T-G3: deactivates a team member (users.deactivated_at). Admin-only,
// jurisdiction-scoped (deactivateUser's own query filters on
// jurisdiction_id, so this can never touch another jurisdiction's user
// even if a userId is guessed/enumerated), self-deactivation blocked, and
// the last active admin of a jurisdiction can never be deactivated by
// anyone — see src/core/admin/actions.ts deactivateUser's own comment for
// the full reasoning.
const ERROR_MESSAGES: Record<string, string> = {
  not_found: "User not found.",
  cannot_act_on_self: "You cannot deactivate your own account. Ask another administrator.",
  already_deactivated: "This user is already deactivated.",
  last_admin: "This is the last active administrator for this jurisdiction and cannot be deactivated.",
};

export async function POST(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: targetUserId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = await requireActiveRole(session, ["admin"]);

    const result = await deactivateUser(jurisdictionId, userId, targetUserId);

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error] ?? "Could not deactivate this user.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[admin] deactivate user failed:", err);
    return NextResponse.json({ error: "Could not deactivate this user." }, { status: 500 });
  }
}
