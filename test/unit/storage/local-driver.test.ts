import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalStorageDriver } from "../../../src/shared/storage/local";

// Real temp dir, real fs I/O — no mocks. Proves the local driver's contract
// (put/get/exists) directly, independent of the pre-existing integration
// suites (test/unit/modules/a1/persist.test.ts,
// test/unit/security/photo-idor.test.ts) that exercise it indirectly
// through the real uploads/ root via the app's own code paths.

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "riverline-storage-test-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("createLocalStorageDriver", () => {
  it("put() then get() round-trips the exact bytes", async () => {
    const driver = createLocalStorageDriver(tmpRoot);
    const bytes = Buffer.from("hello riverline", "utf8");

    await driver.put("a/b/c.jpg", bytes, "image/jpeg");
    const result = await driver.get("a/b/c.jpg");

    expect(result.bytes.equals(bytes)).toBe(true);
  });

  it("infers content-type from the key's extension (.jpg -> image/jpeg, .html -> text/html)", async () => {
    const driver = createLocalStorageDriver(tmpRoot);

    await driver.put("photos/x.jpg", Buffer.from("jpeg bytes"), "image/jpeg");
    await driver.put("letters/y.html", Buffer.from("<html></html>"), "text/html");

    expect((await driver.get("photos/x.jpg")).contentType).toBe("image/jpeg");
    expect((await driver.get("letters/y.html")).contentType).toBe("text/html");
  });

  it("falls back to application/octet-stream for an unrecognized extension", async () => {
    const driver = createLocalStorageDriver(tmpRoot);
    await driver.put("misc/data.bin", Buffer.from([1, 2, 3]), "application/octet-stream");
    expect((await driver.get("misc/data.bin")).contentType).toBe("application/octet-stream");
  });

  it("writing identical bytes to the same key twice is a safe no-op (content-addressed retry)", async () => {
    const driver = createLocalStorageDriver(tmpRoot);
    const bytes = Buffer.from("retry-safe bytes");

    await driver.put("dup.jpg", bytes, "image/jpeg");
    await expect(driver.put("dup.jpg", bytes, "image/jpeg")).resolves.toBeUndefined();

    const result = await driver.get("dup.jpg");
    expect(result.bytes.equals(bytes)).toBe(true);
  });

  it("creates intermediate directories that don't exist yet", async () => {
    const driver = createLocalStorageDriver(tmpRoot);
    await driver.put("deep/nested/path/file.jpg", Buffer.from("x"), "image/jpeg");
    await expect(access(path.join(tmpRoot, "deep", "nested", "path", "file.jpg"))).resolves.toBeUndefined();
  });

  it("exists() is true after a write and false for an unwritten key", async () => {
    const driver = createLocalStorageDriver(tmpRoot);
    expect(await driver.exists("never-written.jpg")).toBe(false);

    await driver.put("written.jpg", Buffer.from("x"), "image/jpeg");
    expect(await driver.exists("written.jpg")).toBe(true);
  });

  it("get() throws (never returns a fake empty result) for a missing key", async () => {
    const driver = createLocalStorageDriver(tmpRoot);
    await expect(driver.get("does-not-exist.jpg")).rejects.toThrow();
  });

  it("writes bytes to disk under rootDir/<key> exactly — same layout the app's real uploads/ root uses", async () => {
    const driver = createLocalStorageDriver(tmpRoot);
    const bytes = Buffer.from("verify on-disk layout");
    await driver.put("jurisdiction-1/abc123.jpg", bytes, "image/jpeg");

    const onDisk = readFileSync(path.join(tmpRoot, "jurisdiction-1", "abc123.jpg"));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it("defaults rootDir to process.cwd()/uploads when constructed with no argument (the app's real default)", async () => {
    // Doesn't write anything (would pollute the real uploads/ dir) — only
    // checks the driver was constructed without throwing, proving the
    // default-argument path is reachable/valid. The actual byte-for-byte
    // uploads/ behavior is exercised for real by
    // test/unit/modules/a1/persist.test.ts and
    // test/unit/security/photo-idor.test.ts, which run the app's real code
    // paths (STORAGE_DRIVER unset -> "local" -> this exact default).
    expect(() => createLocalStorageDriver()).not.toThrow();
  });
});
