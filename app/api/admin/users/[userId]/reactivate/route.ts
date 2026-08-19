import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireActiveRole, AuthError } from "@/core/auth";
import { reactivateUser } from "@/core/admin";

// T-G3: reactivates a previously deactivated team member. Admin-only,
// jurisdiction-scoped.
const ERROR_MESSAGES: Record<string, string> = {
  not_found: "User not found.",
  already_active: "This user is already active.",
};

export async function POST(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: targetUserId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = await requireActiveRole(session, ["admin"]);

    const result = await reactivateUser(jurisdictionId, userId, targetUserId);

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error] ?? "Could not reactivate this user.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[admin] reactivate user failed:", err);
    return NextResponse.json({ error: "Could not reactivate this user." }, { status: 500 });
  }
}
