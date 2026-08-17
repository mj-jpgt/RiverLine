import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { overrideElementDamage } from "../../../../determination/_lib/actions";

// Official (or admin) overrides one element's damage %. Assessor/viewer
// roles are forbidden — this is a determination-review action, not part of
// the field capture flow (T-C3 owns that). Reason is mandatory; an empty
// reason is rejected with a 400 the UI surfaces as a designed inline error,
// never a silent failure or a submit that just does nothing.
const bodySchema = z.object({
  elementCode: z.string().min(1),
  damagePct: z.number().int().min(0).max(100),
  reason: z.string(),
});

const ERROR_MESSAGES: Record<string, string> = {
  reason_required: "A reason is required to override this element.",
  invalid_damage_pct: "Damage percentage must be a whole number between 0 and 100.",
  not_found: "Assessment or element not found.",
  compute_failed: "The override was saved, but recalculation failed. Try recomputing from the calculation view.",
};

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const result = await overrideElementDamage(
      jurisdictionId,
      userId,
      clientId,
      parsed.data.elementCode,
      parsed.data.damagePct,
      parsed.data.reason,
    );

    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      return NextResponse.json(
        { error: ERROR_MESSAGES[result.error ?? ""] ?? "Could not save the override.", errorCode: result.error },
        { status },
      );
    }

    return NextResponse.json({ ok: true, calculation: result.compute?.status === "ok" ? result.compute.calculation : null });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[determination] override-element failed:", err);
    return NextResponse.json({ error: "Could not save the override." }, { status: 500 });
  }
}
