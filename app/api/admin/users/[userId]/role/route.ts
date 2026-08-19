import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireActiveRole, AuthError } from "@/core/auth";
import { changeUserRole, ROLES } from "@/core/admin";

// T-G3: changes a team member's role. Admin-only, jurisdiction-scoped,
// self-change blocked, and demoting the last active admin of a
// jurisdiction away from 'admin' is blocked — see
// src/core/admin/actions.ts changeUserRole's own comment.
const bodySchema = z.object({ role: z.enum(ROLES) });

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "User not found.",
  cannot_act_on_self: "You cannot change your own role. Ask another administrator.",
  role_invalid: "Choose a valid role.",
  last_admin: "This is the last active administrator for this jurisdiction and cannot be changed to another role.",
  no_change: "That user already has this role.",
};

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: targetUserId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = await requireActiveRole(session, ["admin"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const result = await changeUserRole(jurisdictionId, userId, targetUserId, { role: parsed.data.role });

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error] ?? "Could not change this user's role.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[admin] change user role failed:", err);
    return NextResponse.json({ error: "Could not change this user's role." }, { status: 500 });
  }
}
