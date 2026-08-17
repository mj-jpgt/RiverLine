import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashToken } from "./crypto";

describe("crypto", () => {
  it("generates distinct, sufficiently long tokens", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes deterministically and never returns the raw token", () => {
    const token = "fixed-test-token-value";
    const hash = hashToken(token);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
