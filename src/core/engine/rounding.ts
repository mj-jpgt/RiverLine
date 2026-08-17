// Exact, floating-point-error-proof rounding for the ratio calculation.
//
// The 50% rule carries legal weight (AGENTS.md header) and the routing
// bands have inclusive boundaries (README: "0.55 -> upper boundary
// inclusive", "0.45 -> lower boundary inclusive"). A naive
// `Math.round((total / market) * 10000) / 10000` risks exactly the failure
// mode this file exists to prevent: JS numbers cannot represent most
// decimal fractions exactly in binary (e.g. 39250 / 80000 = 0.490625 has no
// exact IEEE-754 double representation), so a value that is mathematically
// just below a rounding boundary could be stored as just above it (or vice
// versa) and flip a determination between BORDERLINE and SD.
//
// Fix: never divide two floats and round the float result. Convert both
// operands to exact integer cents first (safe because every currency
// amount this engine sees — total_repair_cost, market_value_used — carries
// at most 2 decimal places, per schema/core.sql's numeric(12,2) columns;
// Math.round(x * 100) recovers the exact cent integer even though x*100
// itself may be an imprecise double, because currency-scale floating-point
// error (~1e-10 relative) is many orders of magnitude smaller than half a
// cent for any real repair cost or market value), then do the division as
// exact BigInt integer arithmetic with an explicit half-up remainder check.

/**
 * Returns ratio-in-basis-points-of-4-decimal-places, i.e. round_half_up(
 * (totalRepairCost / marketValueUsed) * 10000), as an exact integer. Both
 * the numeric ratio (divide by 10000) and the threshold-band comparison
 * should be derived from this integer, never from a re-divided float, so
 * boundary comparisons (0.45, 0.55) are exact too.
 */
export function ratioBasisPoints(totalRepairCost: number, marketValueUsed: number): bigint {
  if (!(marketValueUsed > 0)) {
    throw new Error("market_value_used must be > 0");
  }
  const totalCents = BigInt(Math.round(totalRepairCost * 100));
  const marketCents = BigInt(Math.round(marketValueUsed * 100));

  const numerator = totalCents * 10000n;
  const quotient = numerator / marketCents; // BigInt division truncates toward 0
  const remainder = numerator % marketCents;

  // Half-up: round away from zero exactly at the halfway point. All values
  // here are non-negative (market_value_used > 0 is enforced above, and
  // total_repair_cost is a sum of non-negative element costs), so "half-up"
  // and "round half away from zero" coincide.
  const roundUp = remainder * 2n >= marketCents;
  return roundUp ? quotient + 1n : quotient;
}

/** Convenience wrapper returning the rounded ratio as a plain number
 * (basis points / 10000). Use ratioBasisPoints() directly for threshold
 * comparisons to avoid re-introducing float boundary risk. */
export function roundRatioHalfUp4dp(totalRepairCost: number, marketValueUsed: number): number {
  return Number(ratioBasisPoints(totalRepairCost, marketValueUsed)) / 10000;
}
