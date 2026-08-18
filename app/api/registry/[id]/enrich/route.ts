import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { applyEnrichment, getEnrichmentSuggestions } from "@/core/registry";

// GET: "Refresh from county records" (and the automatic on-page-load
// prefill — app/registry/[id]/EnrichmentPanel.tsx calls this on mount when
// any tracked field is missing). Read-only, no DB write. Never a 5xx for a
// county-service outage — that is the "degrade silently to manual entry"
// case, returned as { available: false } with a 200 so the client renders
// a calm empty state, not an error banner.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official", "viewer"]);
    const result = await getEnrichmentSuggestions(jurisdictionId, userId, id);
    if ("notFound" in result) {
      return NextResponse.json({ error: "Structure not found." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[registry] enrich GET failed:", err);
    return NextResponse.json({ error: "Could not check county records. Try again." }, { status: 500 });
  }
}

// z.record() with an enum key schema requires EVERY enum member present
// (Zod v4 semantics — verified empirically against this repo's zod@4.4.3:
// z.record(z.enum(["a","b"]), z.number()).safeParse({ a: 1 }) fails with
// "b: Invalid input: expected number, received undefined"). z.partialRecord
// is the v4 API for "some keys, not all" — accepting one field is exactly
// this route's normal case (the assessor accepts fields one at a time).
const bodySchema = z.object({
  accepted: z
    .partialRecord(
      z.enum(["improvementValue", "sqFt", "yearBuilt", "stories", "occupancyType", "propClass"]),
      z.union([z.string(), z.number()]),
    )
    .refine((obj) => Object.keys(obj).length > 0, "At least one field is required."),
  sourceLabel: z.string().min(1),
});

// POST: accept one or more suggested fields. Viewer role cannot mutate,
// matching occupancy/route.ts's precedent.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "At least one accepted field is required." }, { status: 400 });
    }

    const result = await applyEnrichment(
      jurisdictionId,
      userId,
      id,
      parsed.data.accepted,
      parsed.data.sourceLabel,
    );
    if (!result.ok) {
      return NextResponse.json({ error: "Structure not found." }, { status: 404 });
    }
    return NextResponse.json({
      structure: result.structure,
      applied: result.applied,
      skipped: result.skipped,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[registry] enrich POST failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
