import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { setOccupancyType } from "@/core/registry";

const bodySchema = z.object({
  occupancyType: z.enum(["residential", "non_residential"]),
});

// Assessor-in-the-field sets occupancy_type when the parcel ingest left it
// NULL (unknown/ambiguous PROPCLASS — never guessed at ingest time). Viewer
// role cannot mutate; every other role can.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official"]);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "occupancyType must be 'residential' or 'non_residential'." },
        { status: 400 },
      );
    }

    const result = await setOccupancyType(jurisdictionId, userId, id, parsed.data.occupancyType);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      const error =
        result.reason === "not_found"
          ? "Structure not found."
          : "Occupancy type is already set. Use the official override flow to change it.";
      return NextResponse.json({ error }, { status });
    }

    return NextResponse.json({ structure: result.structure });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[registry] occupancy update failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
