import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { updateJurisdictionSettings } from "@/core/admin";

// Admin-only: jurisdiction settings (ordinance citation, appeal window,
// letterhead name/address, optional ICC text). Parallel to
// app/letters/[clientId]/ordinance/route.ts (task instructions: "reuse...
// if sensible, otherwise a parallel admin endpoint") — that route and its
// module (src/modules/a1-letters) are left untouched; this route owns the
// same jurisdictions columns through src/core/admin's own validated,
// audited path. Both ultimately write the same letterhead_config keys, so
// app/letters continues to read whichever was entered last correctly.
const bodySchema = z.object({
  ordinanceCitation: z.string(),
  appealWindowDays: z.number().nullable(),
  letterheadName: z.string().nullable(),
  addressLines: z.array(z.string()).nullable(),
  iccText: z.string().nullable(),
});

const ERROR_MESSAGES: Record<string, string> = {
  citation_required: "The ordinance citation cannot be blank.",
  invalid_appeal_window: "Appeal window must be a positive whole number of days.",
  not_found: "Jurisdiction not found.",
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const result = await updateJurisdictionSettings(jurisdictionId, userId, {
      ordinanceCitation: parsed.data.ordinanceCitation,
      appealWindowDays: parsed.data.appealWindowDays,
      letterheadName: parsed.data.letterheadName,
      addressLines: parsed.data.addressLines,
      iccText: parsed.data.iccText,
    });

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error] ?? "Could not save.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[admin] update jurisdiction settings failed:", err);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
