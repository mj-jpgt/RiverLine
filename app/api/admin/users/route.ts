import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireActiveRole, AuthError } from "@/core/auth";
import { createUser, ROLES } from "@/core/admin";

// T-G3: the only real (non-seed-script) way to create a users row.
// Creating the row IS the invite — schema/core.sql's magic-link allowlist
// model means a user who exists is immediately eligible to sign in (see
// docs/BLOCKERS.md B4 and src/core/admin/actions.ts createUser's comment).
// Admin-only, and requireActiveRole (not requireRole) so a deactivated
// admin session cannot use this route even if its signed cookie is still
// otherwise valid.
const bodySchema = z.object({
  email: z.string(),
  role: z.enum(ROLES),
});

const ERROR_MESSAGES: Record<string, string> = {
  email_required: "An email address is required.",
  email_invalid: "That does not look like a valid email address.",
  role_invalid: "Choose a role.",
  email_exists: "A user with this email already exists.",
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = await requireActiveRole(session, ["admin"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const result = await createUser(jurisdictionId, userId, {
      email: parsed.data.email,
      role: parsed.data.role,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error] ?? "Could not create the user.", errorCode: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, user: result.user });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[admin] create user failed:", err);
    return NextResponse.json({ error: "Could not create the user." }, { status: 500 });
  }
}
