import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { overrideMarketValue } from "../../../../determination/_lib/actions";

// Official overrides the market value used in the calculation (e.g. an
// independent appraisal). value_source is restricted to the two
// schema-legal override values (schema/core.sql structures.value_source
// CHECK constraint) — never a fabricated third option. Reason mandatory,
// same as the element override.
const bodySchema = z.object({
  value: z.number().positive(),
  valueSource: z.enum(["official_override", "appraisal"]),
  reason: z.string(),
});

const ERROR_MESSAGES: Record<string, string> = {
  reason_required: "A reason is required to override the market value.",
  invalid_value: "Market value must be a positive number.",
  invalid_value_source: "Value source must be 'official_override' or 'appraisal'.",
  not_found: "Assessment or structure not found.",
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

    const result = await overrideMarketValue(
      jurisdictionId,
      userId,
      clientId,
      parsed.data.value,
      parsed.data.valueSource,
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
    console.error("[determination] override-value failed:", err);
    return NextResponse.json({ error: "Could not save the override." }, { status: 500 });
  }
}
