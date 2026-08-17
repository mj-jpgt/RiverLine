import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { computeAndPersistCalculation } from "../../../calculation/_lib/compute";

// The manual "Recompute" trigger for the calculation view
// (app/calculation/[clientId]/page.tsx). The automatic trigger — "when an
// assessment syncs complete" — runs the identical
// computeAndPersistCalculation() call directly from the page's server
// component on first view (no extra network hop needed there); this route
// exists for the explicit on-demand re-run button, which always inserts a
// new calculations row per AGENTS.md rule 10 (never UPDATE).

const bodySchema = z.object({ clientId: z.string().min(1) });

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const result = await computeAndPersistCalculation(jurisdictionId, userId, parsed.data.clientId);

    if (result.status !== "ok") {
      return NextResponse.json({ status: result.status }, { status: 200 });
    }

    return NextResponse.json({
      status: "ok",
      calculationId: result.calculation.id,
      ratio: result.calculation.ratio,
      thresholdResult: result.calculation.thresholdResult,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[calculation] compute failed:", err);
    return NextResponse.json({ error: "Calculation failed." }, { status: 500 });
  }
}
