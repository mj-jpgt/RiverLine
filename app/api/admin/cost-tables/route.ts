import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { insertCostTable } from "@/core/admin";

// Admin-only: the ONLY route in this codebase that lets a real user (not a
// test harness) load a cost_tables row. See docs/BLOCKERS.md B1 and
// specs/constitution.md #2 — this is the resolution path a jurisdiction
// uses once it has picked its own cost-estimating guide; it never writes a
// dollar figure the request body didn't supply.
const numberRecord = z.record(z.string(), z.number());

const bodySchema = z.object({
  version: z.string(),
  sourceCitation: z.string(),
  effectiveDateIso: z.string(),
  payload: z.object({
    residential: numberRecord,
    non_residential: numberRecord,
  }),
});

const ERROR_MESSAGES: Record<string, string> = {
  version_required: "A version label is required.",
  citation_required: "The source citation cannot be blank.",
  citation_too_short: "The source citation is too short to be a real source. Name the guide, edition, and page.",
  effective_date_invalid: "Effective date must be a valid date (YYYY-MM-DD).",
  payload_invalid: "The per-element costs are invalid.",
  version_exists: "A cost table with this version label already exists. Use a different version label.",
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

    const result = await insertCostTable(jurisdictionId, userId, {
      version: parsed.data.version,
      sourceCitation: parsed.data.sourceCitation,
      effectiveDateIso: parsed.data.effectiveDateIso,
      payload: parsed.data.payload,
    });

    if (!result.ok) {
      const status = 400;
      return NextResponse.json(
        {
          error: ERROR_MESSAGES[result.error] ?? "Could not save the cost table.",
          errorCode: result.error,
          fieldErrors: result.fieldErrors ?? [],
        },
        { status },
      );
    }

    return NextResponse.json({ ok: true, version: result.version });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[admin] insert cost table failed:", err);
    return NextResponse.json({ error: "Could not save the cost table." }, { status: 500 });
  }
}
