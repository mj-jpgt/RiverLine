import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import {
  getCaseloadForExport,
  buildCsv,
  resolveBandFilter,
  resolveIsoDate,
  resolveSearch,
  resolveSort,
  resolveStatusFilter,
} from "@/modules/a2-dashboard";

// "Export CSV" — streams the CURRENT FILTERED VIEW (task instructions,
// spec §6.4): real columns an official can open directly in Excel.
// address, parcel_id, ratio, band, determination status, adopted date,
// value used, value_source, cost_table_version — the exact column list the
// task names, in that order.
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "official"]);
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(err.message, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const filters = {
    search: resolveSearch(params.get("search")),
    status: resolveStatusFilter(params.get("status")),
    band: resolveBandFilter(params.get("band")),
    dateFrom: resolveIsoDate(params.get("dateFrom")),
    dateTo: resolveIsoDate(params.get("dateTo")),
  };
  const { column, direction } = resolveSort(params.get("sort"), params.get("dir"));

  const rows = await getCaseloadForExport(guarded.jurisdictionId, guarded.userId, filters, column, direction);

  const headers = [
    "address",
    "parcel_id",
    "ratio",
    "band",
    "determination_status",
    "adopted_date",
    "value_used",
    "value_source",
    "cost_table_version",
  ];
  const dataRows = rows.map((r) => [
    r.address,
    r.parcelId,
    r.ratio === null ? "" : r.ratio.toFixed(4),
    r.band ?? "",
    r.determinationStatus ?? "",
    r.adoptedAt ? r.adoptedAt.slice(0, 10) : "",
    r.marketValueUsed === null ? "" : r.marketValueUsed.toFixed(2),
    r.valueSource ?? "",
    r.costTableVersion ?? "",
  ]);
  const csv = buildCsv(headers, dataRows);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="caseload-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
