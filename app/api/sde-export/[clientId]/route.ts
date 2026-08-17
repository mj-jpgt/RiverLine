import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import {
  buildAssessmentExportJson,
  buildElementCsv,
  buildSummaryCsv,
  getExportAssessmentData,
} from "@/modules/a3-sde-export";

// T-A3: per-assessment SDE 3.0-structured export.
//
// Official/admin only (per task instructions "assessment-with-calculation
// (official/admin only, tenant-scoped)") — the export surfaces the same
// legally-relevant facts as the determination review screen, so it gets the
// same role gate as app/api/determination/[clientId]/adopt (admin/official).
// Tenant scoping happens inside getExportAssessmentData via withTenant()
// (RLS-enforced), same pattern every other data route in this codebase uses.
//
// `?format=json` (default) — one machine-readable JSON document.
// `?format=csv&kind=elements` — one CSV row per assessment-element.
// `?format=csv&kind=summary` — one CSV summary row for the assessment.
//
// This route does NOT claim SDE import compatibility anywhere in its
// response or copy — see docs/data-contracts/sde-export-mapping.md
// "IMPORTANT" section. It claims only "SDE 3.0-structured."

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "official"]);

    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "json";
    const kind = url.searchParams.get("kind") ?? "elements";

    const result = await getExportAssessmentData(jurisdictionId, userId, clientId);

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
    }
    if (result.status === "no_calculation") {
      return NextResponse.json(
        { error: "No calculation exists yet for this assessment — nothing to export." },
        { status: 409 },
      );
    }

    const filenameSafeClientId = clientId.replace(/[^a-zA-Z0-9._-]/g, "_");

    if (format === "csv") {
      const csv = kind === "summary" ? buildSummaryCsv(result.data) : buildElementCsv(result.data);
      const suffix = kind === "summary" ? "summary" : "elements";
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="sde-export-${filenameSafeClientId}-${suffix}.csv"`,
        },
      });
    }

    const json = buildAssessmentExportJson(result.data, new Date().toISOString());
    return new NextResponse(JSON.stringify(json, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="sde-export-${filenameSafeClientId}.json"`,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[sde-export] export failed:", err);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
