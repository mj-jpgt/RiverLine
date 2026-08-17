import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { nearestStructures } from "@/core/registry";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// "Near me": nearest 10 structures by real PostGIS distance, given a GPS
// point the browser's Geolocation API supplied client-side. No map
// dependency, no client-side distance math — server computes it against
// the precomputed geom column (AGENTS.md "Geospatial": reading a stored
// geometry at request time is serving-path-legal; joins/rasters are not).
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, [
      "admin",
      "assessor",
      "official",
      "viewer",
    ]);

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      lat: url.searchParams.get("lat"),
      lng: url.searchParams.get("lng"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid lat/lng is required." }, { status: 400 });
    }

    const results = await nearestStructures(jurisdictionId, userId, parsed.data.lat, parsed.data.lng);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[registry] near failed:", err);
    return NextResponse.json({ error: "Could not find nearby structures. Try again." }, { status: 500 });
  }
}
