import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { searchAssessmentsForEstimates } from "@/modules/a4-estimates";

// Backs app/estimates/EstimatesSearch.tsx — the module's own entry point
// (no other agent's page links into app/estimates/ yet; see
// docs/journal/2026-08-17-w2-estimates.md "integration point" note). Same
// role set as the upload/confirm routes; viewer is read-only elsewhere in
// this codebase but this module has no viewer-only need here, so it's kept
// consistent with the other estimates routes.
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official", "viewer"]);
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const results = await searchAssessmentsForEstimates(jurisdictionId, userId, q);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[estimates] search failed:", err);
    return NextResponse.json({ error: "Search failed. Try again." }, { status: 500 });
  }
}
