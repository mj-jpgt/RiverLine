import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, sniffImageType } from "../../../src/shared/security/upload-validation";

describe("sniffImageType", () => {
  it("identifies a real JPEG by magic bytes", () => {
    const bytes = readFileSync(
      path.resolve(__dirname, "../../fixtures/photos/sample-exterior.jpg"),
    );
    expect(sniffImageType(bytes)).toBe("jpeg");
  });

  it("identifies a PNG by magic bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
    expect(sniffImageType(png)).toBe("png");
  });

  it("identifies a WEBP by magic bytes", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]), // chunk size, irrelevant to sniffing
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(sniffImageType(webp)).toBe("webp");
  });

  it("rejects a claimed-jpeg payload that is actually a script (no valid signature)", () => {
    const fakePayload = Buffer.from("<script>alert(1)</script>", "utf8");
    expect(sniffImageType(fakePayload)).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it("rejects a truncated/malformed JPEG-like header", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("rejects an HTML file re-labeled with a .jpg extension (the classic content-type-spoof case)", () => {
    const html = Buffer.from("<html><body>not a photo</body></html>", "utf8");
    expect(sniffImageType(html)).toBeNull();
  });
});

describe("MAX_PHOTO_BYTES", () => {
  it("is a sane, documented ceiling (8MB)", () => {
    expect(MAX_PHOTO_BYTES).toBe(8 * 1024 * 1024);
  });
});
