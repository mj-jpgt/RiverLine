import { describe, expect, it } from "vitest";
import {
  buildLetterFacts,
  renderLetterHtml,
  isNonEmptyOrdinanceCitation,
  isValidAppealWindowDays,
  MANDATORY_FOOTER_TEXT,
  TEMPLATE_VERSION,
} from "../../../../src/modules/a1-letters/pure";
import type { RawLetterInputs } from "../../../../src/modules/a1-letters/pure";

// Fixture ordinance text is OBVIOUSLY synthetic per task instructions —
// never usable as real legal text even by accident.
const TEST_CITATION = "TEST ORDINANCE §00-000 — fixture, not legal text";

function baseInputs(overrides: Partial<RawLetterInputs> = {}): RawLetterInputs {
  return {
    jurisdictionName: "Demo City",
    letterheadAddressLines: null,
    structureAddress: "123 Practice Ln",
    parcelId: "DEMO-PRACTICE-001",
    assessmentCompletedAtIso: "2026-06-01T12:00:00.000Z",
    ratio: 0.634,
    thresholdResult: "SD",
    ordinanceCitation: TEST_CITATION,
    appealDeadlineDateIso: null,
    officialEmail: "official@example.gov",
    adoptedAtIso: "2026-06-05T09:00:00.000Z",
    iccText: null,
    ...overrides,
  };
}

describe("buildLetterFacts", () => {
  it("formats the ratio to one decimal place and dates to date-only", () => {
    const facts = buildLetterFacts(baseInputs());
    expect(facts.ratioPct).toBe("63.4");
    expect(facts.assessmentDateIso).toBe("2026-06-01");
    expect(facts.adoptedDateIso).toBe("2026-06-05");
    expect(facts.templateVersion).toBe(TEMPLATE_VERSION);
  });

  it("never invents letterhead address lines or ICC text when absent", () => {
    const facts = buildLetterFacts(baseInputs());
    expect(facts.letterheadAddressLines).toEqual([]);
    expect(facts.iccText).toBeNull();
  });

  it("carries the ordinance citation through verbatim, unmodified", () => {
    const facts = buildLetterFacts(baseInputs());
    expect(facts.ordinanceCitation).toBe(TEST_CITATION);
  });
});

describe("renderLetterHtml — SD / NOT_SD variants", () => {
  it("renders a definite SD finding statement referencing the 50% threshold", () => {
    const facts = buildLetterFacts(baseInputs({ thresholdResult: "SD", ratio: 0.72 }));
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).toContain("IS substantially damaged");
    expect(html).not.toContain("IS NOT substantially damaged");
    expect(html).toContain("50%");
    expect(html).toContain("72.0%");
  });

  it("renders a definite NOT_SD finding statement referencing the 50% threshold", () => {
    const facts = buildLetterFacts(baseInputs({ thresholdResult: "NOT_SD", ratio: 0.12 }));
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).toContain("IS NOT substantially damaged");
    expect(html).toContain("50%");
    expect(html).toContain("12.0%");
  });

  it("includes the mandatory tool-is-an-aid / official-is-decision-maker footer in every variant", () => {
    for (const thresholdResult of ["SD", "NOT_SD"] as const) {
      const facts = buildLetterFacts(baseInputs({ thresholdResult }));
      const html = renderLetterHtml(facts, { issued: true });
      expect(html).toContain(MANDATORY_FOOTER_TEXT);
    }
  });

  it("renders the ordinance citation verbatim in the letter body", () => {
    const facts = buildLetterFacts(baseInputs());
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).toContain(TEST_CITATION);
  });

  it("includes the structure address, parcel id, and adopting official's email", () => {
    const facts = buildLetterFacts(baseInputs());
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).toContain("123 Practice Ln");
    expect(html).toContain("DEMO-PRACTICE-001");
    expect(html).toContain("official@example.gov");
  });
});

describe("renderLetterHtml — appeal deadline sentence", () => {
  it("omits the appeal sentence when appeal_deadline_date is not set", () => {
    const facts = buildLetterFacts(baseInputs({ appealDeadlineDateIso: null }));
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).not.toContain("appeal deadline");
  });

  it("includes the appeal sentence with the exact date when set", () => {
    const facts = buildLetterFacts(baseInputs({ appealDeadlineDateIso: "2026-07-15" }));
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).toContain("appeal deadline");
    expect(html).toContain("July 15, 2026");
  });
});

describe("renderLetterHtml — ICC paragraph", () => {
  it("omits the ICC paragraph entirely when letterhead_config.icc_text is absent", () => {
    const facts = buildLetterFacts(baseInputs({ iccText: null }));
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).not.toContain("Increased Cost of Compliance");
  });

  it("renders jurisdiction-supplied ICC text verbatim when present, never generated prose", () => {
    const iccText = "TEST-FIXTURE ICC paragraph — jurisdiction-supplied text, not authored by this module.";
    const facts = buildLetterFacts(baseInputs({ iccText }));
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).toContain("Increased Cost of Compliance");
    expect(html).toContain(iccText);
  });
});

describe("renderLetterHtml — preview banner", () => {
  it("shows a preview banner when not yet issued", () => {
    const facts = buildLetterFacts(baseInputs());
    const html = renderLetterHtml(facts, { issued: false });
    expect(html).toContain("PREVIEW");
  });

  it("omits the preview banner once issued", () => {
    const facts = buildLetterFacts(baseInputs());
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).not.toContain("PREVIEW");
  });
});

describe("renderLetterHtml — print correctness (direction.md 'Print': black on white, no background fills)", () => {
  it("uses only black/white as literal colors, never a hex value or a background fill", () => {
    const facts = buildLetterFacts(baseInputs());
    const html = renderLetterHtml(facts, { issued: true });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).toMatch(/color:\s*black/);
    expect(html).toMatch(/background:\s*white/);
  });

  it("hides the preview banner and print button under @media print", () => {
    const facts = buildLetterFacts(baseInputs());
    const html = renderLetterHtml(facts, { issued: false });
    expect(html).toMatch(/@media print[\s\S]*previewBanner[\s\S]*display:\s*none/);
  });
});

describe("isNonEmptyOrdinanceCitation", () => {
  it("rejects null, undefined, and whitespace-only strings", () => {
    expect(isNonEmptyOrdinanceCitation(null)).toBe(false);
    expect(isNonEmptyOrdinanceCitation(undefined)).toBe(false);
    expect(isNonEmptyOrdinanceCitation("   ")).toBe(false);
  });

  it("accepts real text", () => {
    expect(isNonEmptyOrdinanceCitation(TEST_CITATION)).toBe(true);
  });
});

describe("isValidAppealWindowDays", () => {
  it("rejects non-positive, non-finite, and non-numeric values", () => {
    expect(isValidAppealWindowDays(0)).toBe(false);
    expect(isValidAppealWindowDays(-5)).toBe(false);
    expect(isValidAppealWindowDays(Infinity)).toBe(false);
    expect(isValidAppealWindowDays("30")).toBe(false);
    expect(isValidAppealWindowDays(null)).toBe(false);
  });

  it("accepts a positive finite number", () => {
    expect(isValidAppealWindowDays(30)).toBe(true);
  });
});
