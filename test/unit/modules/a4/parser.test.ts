import { describe, expect, it } from "vitest";
import {
  parseMoneyToDollars,
  dollarsToCents,
  centsToDollars,
  parseLineItemsAndTotals,
  reconcileLineItemsAgainstTotal,
  checkSanityBound,
  combinedDocumentHashInput,
} from "../../../../src/modules/a4-estimates/parser";
import type { OcrLine } from "../../../../src/modules/a4-estimates/types";

// Tests against the SPEC (docs/riverline-sdd-build-spec.md §8), not against
// the implementation — per docs/agents/SUBAGENT.md "Role: test agents" #1.

const BBOX = { x0: 0, y0: 0, x1: 100, y1: 20 };

function line(text: string, confidence = 90): OcrLine {
  return { text, bbox: BBOX, confidence };
}

describe("parseMoneyToDollars — spec §8.6 unit/currency artifacts", () => {
  it("THE exact spec-mandated case: '$12,500.00' never becomes 1250000", () => {
    const result = parseMoneyToDollars("$12,500.00");
    expect(result).toBe(12500);
    expect(result).not.toBe(1250000);
  });

  it("parses a plain integer dollar amount", () => {
    expect(parseMoneyToDollars("500")).toBe(500);
  });

  it("parses without a leading dollar sign", () => {
    expect(parseMoneyToDollars("1,234.56")).toBe(1234.56);
  });

  it("parses a large thousands-grouped amount", () => {
    expect(parseMoneyToDollars("$1,250,000.00")).toBe(1250000);
  });

  it("parses accounting-style negative amounts in parentheses", () => {
    expect(parseMoneyToDollars("($500.00)")).toBe(-500);
  });

  it("parses a leading-minus negative amount", () => {
    expect(parseMoneyToDollars("-$500.00")).toBe(-500);
  });

  it("returns null for a string with letters mixed into the number", () => {
    expect(parseMoneyToDollars("$12,5OO.00")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseMoneyToDollars("")).toBeNull();
    expect(parseMoneyToDollars("   ")).toBeNull();
  });

  it("returns null for a malformed thousands grouping (not groups of 3)", () => {
    expect(parseMoneyToDollars("$1,23.00")).toBeNull();
  });

  it("returns null for more than 2 decimal digits", () => {
    expect(parseMoneyToDollars("$12.505")).toBeNull();
  });

  it("never drops the decimal point when stripping thousands separators", () => {
    // A naive `replace(/[^0-9]/g, "")` implementation would turn this into
    // 125000000 (both the comma AND the decimal point stripped). The real
    // implementation must strip only the comma.
    expect(parseMoneyToDollars("$125,000.00")).toBe(125000);
  });
});

describe("dollarsToCents / centsToDollars", () => {
  it("round-trips exactly for a value with cents", () => {
    expect(dollarsToCents(12500)).toBe(1250000);
    expect(centsToDollars(1250000)).toBe(12500);
  });

  it("rounds to the nearest cent for floating point noise", () => {
    expect(dollarsToCents(19.999999999)).toBe(2000);
  });
});

describe("parseLineItemsAndTotals — spec §8.2 wrong-number selection", () => {
  it("extracts a plain line item with description and amount", () => {
    const { lineItems, candidateTotals } = parseLineItemsAndTotals(
      [line("Roof replacement $4,500.00")],
      0,
    );
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]?.description).toBe("Roof replacement");
    expect(lineItems[0]?.amountDollars).toBe(4500);
    expect(candidateTotals).toHaveLength(0);
  });

  it("classifies a 'Total' line as a candidate total, not a line item (never double-counted)", () => {
    const { lineItems, candidateTotals } = parseLineItemsAndTotals(
      [line("Drywall repair $1,200.00"), line("Total $1,200.00")],
      0,
    );
    expect(lineItems).toHaveLength(1);
    expect(candidateTotals).toHaveLength(1);
    expect(candidateTotals[0]?.label).toBe("Total");
    expect(candidateTotals[0]?.amountDollars).toBe(1200);
  });

  it("extracts multiple candidate totals — never auto-picks one (spec: 'require the human to tap the row')", () => {
    const { candidateTotals } = parseLineItemsAndTotals(
      [line("Subtotal $10,000.00"), line("Deposit $2,000.00"), line("Grand Total $12,000.00")],
      0,
    );
    // "Deposit" is not a total keyword, so it's a line item, not a total —
    // both real totals are surfaced as separate candidates.
    const labels = candidateTotals.map((t) => t.label);
    expect(labels).toContain("Subtotal");
    expect(labels).toContain("Grand Total");
    expect(candidateTotals).toHaveLength(2);
  });

  it("skips a line with no trailing money token", () => {
    const { lineItems, candidateTotals } = parseLineItemsAndTotals([line("Estimate prepared for John Smith")], 0);
    expect(lineItems).toHaveLength(0);
    expect(candidateTotals).toHaveLength(0);
  });

  it("does not spuriously match a plain description ending in an OCR-confusable letter with no amount at all", () => {
    // "Wall" and "Total" both end in a letter that's an OCR-confusable for
    // "1" — the loosened trailing-money regex must not treat a bare
    // trailing letter as a 1-character "amount" when there's no real digit
    // anywhere in it.
    const { lineItems, candidateTotals } = parseLineItemsAndTotals(
      [line("Repair scope: interior and exterior wall"), line("Contractor: ACME Wall")],
      0,
    );
    expect(lineItems).toHaveLength(0);
    expect(candidateTotals).toHaveLength(0);
  });

  it("rejects a bare trailing digit run with no currency marker at all (real OCR-observed garble, see journal)", () => {
    // Observed for real running tesseract.js against this module's own
    // fixture: "Roof covering replacement $4,500.00" OCR'd as "Roof
    // covering replacement sas0000" — the actual amount was destroyed, but
    // a bare "000" was still trailing. Surfacing that as amountDollars: 0
    // would be a plausible-looking WRONG value, worse than dropping the
    // line — spec §8.1 applies to what's ever shown as a candidate, not
    // just what gets confirmed.
    const { lineItems } = parseLineItemsAndTotals([line("Roof covering replacement sas0000")], 0);
    expect(lineItems).toHaveLength(0);
  });

  it("still surfaces a line item row when the amount is unparsable, with amountDollars null", () => {
    // A line ending in something money-shaped but malformed (e.g. OCR
    // misread) — the row still renders (spec §8.1: never silently drop a
    // field), flagged with a null amount rather than a guessed number.
    const { lineItems } = parseLineItemsAndTotals([line("Framing repair $1,2OO.00")], 0);
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]?.amountDollars).toBeNull();
  });

  it("tags every candidate with the correct pageIndex", () => {
    const { lineItems } = parseLineItemsAndTotals([line("Paint $500.00")], 2);
    expect(lineItems[0]?.pageIndex).toBe(2);
  });

  it("preserves the source bbox for the highlight overlay", () => {
    const customBbox = { x0: 10, y0: 20, x1: 300, y1: 45 };
    const { lineItems } = parseLineItemsAndTotals([{ text: "Gutters $800.00", bbox: customBbox, confidence: 95 }], 0);
    expect(lineItems[0]?.bbox).toEqual(customBbox);
  });
});

describe("reconcileLineItemsAgainstTotal — spec §8.1 totals must reconcile", () => {
  it("reconciles when line items sum exactly to the selected total", () => {
    const result = reconcileLineItemsAgainstTotal([1000, 2500.5, 999.5], 4500);
    expect(result.reconciles).toBe(true);
    expect(result.differenceCents).toBe(0);
  });

  it("reconciles within a 1-cent tolerance", () => {
    const result = reconcileLineItemsAgainstTotal([33.33, 33.33, 33.34], 100);
    expect(result.reconciles).toBe(true);
  });

  it("flags a real mismatch", () => {
    const result = reconcileLineItemsAgainstTotal([1000, 2000], 5000);
    expect(result.reconciles).toBe(false);
    expect(result.differenceCents).toBe(200000);
  });

  it("uses exact integer-cent arithmetic (no floating point drift across many items)", () => {
    const amounts = Array.from({ length: 20 }, () => 0.1);
    const result = reconcileLineItemsAgainstTotal(amounts, 2);
    expect(result.reconciles).toBe(true);
    expect(result.lineItemsTotalCents).toBe(200);
  });
});

describe("checkSanityBound — spec §8.6 sanity bound (>3x improvement value hard-flags)", () => {
  it("flags a total that exceeds 3x the improvement value", () => {
    const result = checkSanityBound(500000, 140000);
    expect(result.exceedsBound).toBe(true);
    expect(result.thresholdDollars).toBe(420000);
  });

  it("does not flag a total at or under 3x", () => {
    expect(checkSanityBound(420000, 140000).exceedsBound).toBe(false);
    expect(checkSanityBound(100000, 140000).exceedsBound).toBe(false);
  });

  it("returns exceedsBound: null (never a fabricated check) when improvement value is unknown", () => {
    const result = checkSanityBound(999999, null);
    expect(result.exceedsBound).toBeNull();
    expect(result.thresholdDollars).toBeNull();
  });

  it("returns null for a zero or negative improvement value (nothing honest to check against)", () => {
    expect(checkSanityBound(1000, 0).exceedsBound).toBeNull();
    expect(checkSanityBound(1000, -5).exceedsBound).toBeNull();
  });
});

describe("combinedDocumentHashInput — multi-page document identity", () => {
  it("joins page hashes in order with commas, lowercased", () => {
    expect(combinedDocumentHashInput(["ABC123", "def456"])).toBe("abc123,def456");
  });

  it("is order-sensitive (page order matters for document identity)", () => {
    expect(combinedDocumentHashInput(["a", "b"])).not.toBe(combinedDocumentHashInput(["b", "a"]));
  });

  it("handles a single page (the common case) as a one-element join", () => {
    expect(combinedDocumentHashInput(["onlyhash"])).toBe("onlyhash");
  });
});
