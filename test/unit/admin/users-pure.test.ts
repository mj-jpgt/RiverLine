import { describe, expect, it } from "vitest";
import { ROLES, ROLE_DESCRIPTIONS, isValidEmail, isValidUserRole, normalizeEmail } from "../../../src/core/admin";

// T-G3: zero-I/O validation for team user management, same split
// test/unit/admin/pure.test.ts already establishes for the cost-table
// validators.
describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Admin@Example.GOV  ")).toBe("admin@example.gov");
  });
});

describe("isValidEmail", () => {
  it("accepts a plausible email", () => {
    expect(isValidEmail("assessor@example.gov")).toBe(true);
  });

  it("rejects missing @ / domain / local part", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing-domain@")).toBe(false);
    expect(isValidEmail("@missing-local.gov")).toBe(false);
    expect(isValidEmail("no-tld@example")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("isValidUserRole", () => {
  it("accepts every real role", () => {
    for (const r of ROLES) expect(isValidUserRole(r)).toBe(true);
  });

  it("rejects anything else, including case variants and empty string", () => {
    expect(isValidUserRole("Admin")).toBe(false);
    expect(isValidUserRole("superadmin")).toBe(false);
    expect(isValidUserRole("")).toBe(false);
  });
});

describe("ROLE_DESCRIPTIONS", () => {
  it("has a label and a non-empty plain-language description for every role", () => {
    for (const r of ROLES) {
      expect(ROLE_DESCRIPTIONS[r].label.length).toBeGreaterThan(0);
      expect(ROLE_DESCRIPTIONS[r].description.length).toBeGreaterThan(0);
    }
  });

  it("never uses an em dash in the label or description (task copy rule)", () => {
    for (const r of ROLES) {
      expect(ROLE_DESCRIPTIONS[r].label).not.toContain("—");
      expect(ROLE_DESCRIPTIONS[r].description).not.toContain("—");
    }
  });
});
