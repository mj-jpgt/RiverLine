import { describe, expect, it } from "vitest";
import { ratioBasisPoints, roundRatioHalfUp4dp } from "@/core/engine/rounding";

// Exercises the rounding helper directly and independently of the engine,
// including a genuine half-up TIE case (5th decimal digit exactly 5) that
// none of the orchestrator's golden fixtures happen to hit (G4/G5 both
// round down on a non-5 digit) but which is exactly the failure mode a
// naive `Math.round(total/market * 10000) / 10000` risks getting wrong due
// to binary floating-point representation error.

describe("roundRatioHalfUp4dp / ratioBasisPoints", () => {
  it("proves G4's exact arithmetic: 39250 / 80000 = 0.490625 -> 0.4906", () => {
    expect(roundRatioHalfUp4dp(39250, 80000)).toBe(0.4906);
  });

  it("proves G5's exact arithmetic: 64000 / 140000 = 0.457142... -> 0.4571", () => {
    expect(roundRatioHalfUp4dp(64000, 140000)).toBe(0.4571);
  });

  it("rounds a genuine half-up tie away from zero (0.12345 -> 0.1235, not 0.1234)", () => {
    // 12345 / 100000 = 0.12345 exactly — the 5th decimal digit is exactly
    // 5, a true tie at the 4dp boundary. Half-up means this must round to
    // 0.1235, never 0.1234 (banker's/round-half-even would give 0.1234
    // here since 4 is even — this proves the implementation is NOT
    // round-half-even).
    expect(roundRatioHalfUp4dp(12345, 100000)).toBe(0.1235);
    expect(ratioBasisPoints(12345, 100000)).toBe(1235n);
  });

  it("rounds a tie at the NOT_SD/BORDERLINE boundary correctly (0.44995 -> 0.4500, inclusive of BORDERLINE)", () => {
    // 44995 / 100000 = 0.44995 exactly — ties up to 0.4500, landing exactly
    // on the BORDERLINE lower boundary (inclusive per the README).
    expect(roundRatioHalfUp4dp(44995, 100000)).toBe(0.45);
  });

  it("does not round when the value is already exact at 4dp (0.45 stays 0.45, no float boundary flip)", () => {
    expect(roundRatioHalfUp4dp(45000, 100000)).toBe(0.45);
    expect(ratioBasisPoints(45000, 100000)).toBe(4500n);
  });

  it("does not round when the value is already exact at 4dp (0.55 stays 0.55)", () => {
    expect(roundRatioHalfUp4dp(55000, 100000)).toBe(0.55);
    expect(ratioBasisPoints(55000, 100000)).toBe(5500n);
  });

  it("throws on market_value_used <= 0", () => {
    expect(() => ratioBasisPoints(100, 0)).toThrow("market_value_used must be > 0");
    expect(() => ratioBasisPoints(100, -5)).toThrow("market_value_used must be > 0");
  });

  it("handles zero total_repair_cost", () => {
    expect(roundRatioHalfUp4dp(0, 200000)).toBe(0);
  });
});
