import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/core/capture/photo";

// processPhoto() itself needs a real <canvas>/createImageBitmap image
// decode pipeline that jsdom does not implement — it is exercised for real
// in test/e2e/offline-capture.spec.ts (a real browser, real JPEG fixture)
// instead. sha256Hex is pure Web Crypto and is fully unit-testable here.
describe("sha256Hex", () => {
  it("matches a known SHA-256 vector for the empty input", async () => {
    const empty = new Uint8Array(0).buffer;
    const hash = await sha256Hex(empty);
    expect(hash).toHaveLength(64);
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is deterministic for the same bytes", async () => {
    const bytes = new TextEncoder().encode("riverline-sdd").buffer;
    const a = await sha256Hex(bytes as ArrayBuffer);
    const b = await sha256Hex(bytes as ArrayBuffer);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different bytes", async () => {
    const a = await sha256Hex(new TextEncoder().encode("a").buffer as ArrayBuffer);
    const b = await sha256Hex(new TextEncoder().encode("b").buffer as ArrayBuffer);
    expect(a).not.toBe(b);
  });
});
