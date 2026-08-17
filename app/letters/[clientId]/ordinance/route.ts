import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { setOrdinanceCitation } from "@/modules/a1-letters";

// Admin-only: writes jurisdictions.ordinance_citation + optionally
// letterhead_config.appeal_window_days / letterhead name / address lines.
// This is the ONLY code path anywhere that can set ordinance_citation —
// never fabricated, never defaulted, always a human-entered value through
// this form (specs/constitution.md #2, docs/BLOCKERS.md B2).
const bodySchema = z.object({
  ordinanceCitation: z.string(),
  appealWindowDays: z.number().positive().nullable().optional(),
  letterheadName: z.string().nullable().optional(),
  letterheadAddressLines: z.array(z.string()).nullable().optional(),
});

const ERROR_MESSAGES: Record<string, string> = {
  citation_required: "The ordinance citation cannot be blank.",
  invalid_appeal_window: "Appeal window must be a positive number of days.",
  not_found: "Jurisdiction not found.",
};

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  await params; // clientId not needed here (jurisdiction-scoped, not assessment-scoped) — kept in the URL so the UI can redirect back to the same letter page.
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const result = await setOrdinanceCitation(jurisdictionId, userId, {
      ordinanceCitation: parsed.data.ordinanceCitation,
      appealWindowDays: parsed.data.appealWindowDays ?? null,
      letterheadName: parsed.data.letterheadName ?? null,
      letterheadAddressLines: parsed.data.letterheadAddressLines ?? null,
    });

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error ?? ""] ?? "Could not save.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[letters] set ordinance failed:", err);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
