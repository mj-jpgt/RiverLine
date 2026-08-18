import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getOperationalSummary, buildCsv } from "@/modules/a2-dashboard";

// "Operational summary (CSV)" — V5 task 3: the jurisdiction operational
// picture an EMA/county would ask for during an event, as one flat
// metric/value CSV (not a per-structure table — this is the aggregate, the
// per-structure detail is already covered by the existing caseload export).
// Same auth/role-guard pattern as app/dashboard/export/csv/route.ts and
// app/dashboard/export/full/route.ts.
export async function GET() {
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

  const summary = await getOperationalSummary(guarded.jurisdictionId, guarded.userId);

  const money = (n: number | null) => (n === null ? "" : n.toFixed(2));

  const rows: [string, string][] = [
    ["total_structures", String(summary.totalStructures)],
    ["determination_status_draft", String(summary.byDeterminationStatus.draft)],
    ["determination_status_adopted", String(summary.byDeterminationStatus.adopted)],
    ["determination_status_contested", String(summary.byDeterminationStatus.contested)],
    ["determination_status_superseded", String(summary.byDeterminationStatus.superseded)],
    ["determination_status_none", String(summary.byDeterminationStatus.none)],
    ["adopted_substantial_damage_count", String(summary.adoptedSdCount)],
    ["calculation_band_substantial_damage", String(summary.byCalculationBand.SD)],
    ["calculation_band_borderline", String(summary.byCalculationBand.BORDERLINE)],
    ["calculation_band_not_substantial_damage", String(summary.byCalculationBand.NOT_SD)],
    ["calculation_band_no_calculation", String(summary.byCalculationBand.noCalculation)],
    ["residential_substantial_damage", String(summary.byOccupancyAndBand.residential.SD)],
    ["residential_borderline", String(summary.byOccupancyAndBand.residential.BORDERLINE)],
    ["residential_not_substantial_damage", String(summary.byOccupancyAndBand.residential.NOT_SD)],
    ["residential_no_calculation", String(summary.byOccupancyAndBand.residential.noCalculation)],
    ["non_residential_substantial_damage", String(summary.byOccupancyAndBand.nonResidential.SD)],
    ["non_residential_borderline", String(summary.byOccupancyAndBand.nonResidential.BORDERLINE)],
    ["non_residential_not_substantial_damage", String(summary.byOccupancyAndBand.nonResidential.NOT_SD)],
    ["non_residential_no_calculation", String(summary.byOccupancyAndBand.nonResidential.noCalculation)],
    ["unknown_occupancy_substantial_damage", String(summary.byOccupancyAndBand.unknownOccupancy.SD)],
    ["unknown_occupancy_borderline", String(summary.byOccupancyAndBand.unknownOccupancy.BORDERLINE)],
    ["unknown_occupancy_not_substantial_damage", String(summary.byOccupancyAndBand.unknownOccupancy.NOT_SD)],
    ["unknown_occupancy_no_calculation", String(summary.byOccupancyAndBand.unknownOccupancy.noCalculation)],
    ["computed_repair_cost_total_usd", money(summary.totalComputedRepairCost.total)],
    ["computed_repair_cost_substantial_damage_usd", money(summary.totalComputedRepairCost.SD)],
    ["computed_repair_cost_borderline_usd", money(summary.totalComputedRepairCost.BORDERLINE)],
    ["computed_repair_cost_not_substantial_damage_usd", money(summary.totalComputedRepairCost.NOT_SD)],
  ];

  const csv = buildCsv(["metric", "value"], rows);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="operational-summary-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
