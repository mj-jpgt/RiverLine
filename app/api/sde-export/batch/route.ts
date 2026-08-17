import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { buildBatchElementCsv, buildBatchSummaryCsv, getBatchExportData } from "@/modules/a3-sde-export";

// T-A3: jurisdiction-wide CSV batch export — every completed, calculated
// assessment in the caller's tenant. Official/admin only, tenant-scoped via
// getBatchExportData -> withTenant() (RLS-enforced), same gate as the
// per-assessment route.
//
// `?kind=elements` (default) — one row per assessment-element across the
// whole batch.
// `?kind=summary` — one summary row per assessment.

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "official"]);

    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "elements";

    const dataset = await getBatchExportData(jurisdictionId, userId);

    const csv = kind === "summary" ? buildBatchSummaryCsv(dataset) : buildBatchElementCsv(dataset);
    const suffix = kind === "summary" ? "summary" : "elements";

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sde-export-batch-${suffix}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[sde-export] batch export failed:", err);
    return NextResponse.json({ error: "Batch export failed." }, { status: 500 });
  }
}
