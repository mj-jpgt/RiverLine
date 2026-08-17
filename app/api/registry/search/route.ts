import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { searchStructuresByAddress } from "@/core/registry";

// Address type-ahead. Tenant-scoped via withTenant() inside
// searchStructuresByAddress — RLS enforces jurisdiction isolation, this
// route just supplies jurisdictionId/userId from the verified session.
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
    const q = url.searchParams.get("q") ?? "";
    const results = await searchStructuresByAddress(jurisdictionId, userId, q);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[registry] search failed:", err);
    return NextResponse.json({ error: "Search failed. Try again." }, { status: 500 });
  }
}
