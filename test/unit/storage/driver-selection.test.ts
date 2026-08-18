import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStorageDriver } from "../../../src/shared/storage";

// STORAGE_DRIVER selection (docs/adr/0008-object-storage.md). No caching in
// getStorageDriver() (see its own header comment), so flipping the env var
// between assertions in one test is safe and doesn't need a reset hook.

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(resetEnv);

describe("getStorageDriver", () => {
  it('defaults to the local driver when STORAGE_DRIVER is unset (byte-identical to the pre-storage-module app)', async () => {
    delete process.env.STORAGE_DRIVER;
    const driver = getStorageDriver();

    // Prove it's really the local driver, not just "didn't throw": write
    // through it into a throwaway subdirectory of the real uploads/ root and
    // read it back, then clean up.
    const marker = `driver-selection-test-${Date.now()}.jpg`;
    const bytes = Buffer.from("local driver marker");
    await driver.put(marker, bytes, "image/jpeg");
    try {
      expect((await driver.get(marker)).bytes.equals(bytes)).toBe(true);
    } finally {
      rmSync(path.join(process.cwd(), "uploads", marker), { force: true });
    }
  });

  it('selects the local driver explicitly when STORAGE_DRIVER="local"', async () => {
    process.env.STORAGE_DRIVER = "local";
    const driver = getStorageDriver();
    const tmp = mkdtempSync(path.join(os.tmpdir(), "riverline-driver-selection-"));
    try {
      // Confirm it behaves like the local driver contract (put/get
      // round-trip against the real filesystem) — the selection function
      // itself always constructs against process.cwd()/uploads, so this
      // asserts the shape/behavior, not this tmp dir specifically.
      await driver.put("probe.jpg", Buffer.from("x"), "image/jpeg");
      expect(await driver.exists("probe.jpg")).toBe(true);
    } finally {
      rmSync(path.join(process.cwd(), "uploads", "probe.jpg"), { force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws a clear error for an unknown STORAGE_DRIVER value (never silently falls back)', () => {
    process.env.STORAGE_DRIVER = "s3-legacy-typo";
    expect(() => getStorageDriver()).toThrow(/Unknown STORAGE_DRIVER/);
  });

  it('selecting STORAGE_DRIVER="supabase" without credentials throws immediately, naming the missing env vars', () => {
    process.env.STORAGE_DRIVER = "supabase";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.STORAGE_BUCKET;

    expect(() => getStorageDriver()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('selecting STORAGE_DRIVER="supabase" with URL/key but no STORAGE_BUCKET throws naming the bucket var', () => {
    process.env.STORAGE_DRIVER = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    delete process.env.STORAGE_BUCKET;

    expect(() => getStorageDriver()).toThrow(/STORAGE_BUCKET/);
  });

  it('selecting STORAGE_DRIVER="supabase" with all three env vars set constructs without throwing (no network call yet)', () => {
    process.env.STORAGE_DRIVER = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.STORAGE_BUCKET = "riverline-test-bucket";

    expect(() => getStorageDriver()).not.toThrow();
  });
});
