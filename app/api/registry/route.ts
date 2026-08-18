import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { createManualStructure } from "@/core/registry";

const bodySchema = z.object({
  address: z.string().trim().min(1, "Address is required."),
  parcelId: z.string().trim().min(1).nullable().optional(),
  occupancyType: z.enum(["residential", "non_residential"]).nullable().optional(),
});

// POST /api/registry: the "Structure not found?" manual-creation path
// (app/registry/new). A field assessor hand-creates a minimal structure
// record when a flooded address is not in the loaded parcel set (coverage
// gap — docs/journal/2026-08-18-f1-registry.md "Coverage"). Address is the
// only required field; parcel number is optional. The created row is
// always flagged unverified (src/core/registry/queries.ts
// createManualStructure's MANUAL_ENTRY_MARKER) — never silently presented
// as if it came from the county ingest.
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Address is required." },
        { status: 400 },
      );
    }

    const structure = await createManualStructure(jurisdictionId, userId, {
      address: parsed.data.address,
      parcelId: parsed.data.parcelId ?? null,
      occupancyType: parsed.data.occupancyType ?? null,
    });

    return NextResponse.json({ structure }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[registry] manual create failed:", err);
    return NextResponse.json({ error: "Could not create the structure. Try again." }, { status: 500 });
  }
}
