import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseStorageDriver } from "../../../src/shared/storage/supabase";

// Real contract test against a REAL Supabase Storage bucket — no mocks. Runs
// ONLY when the three env vars a real bucket needs are present
// (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORAGE_BUCKET — see
// .env.example / docs/adr/0008-object-storage.md). Otherwise it skips
// visibly via Vitest's own `describe.skipIf` (shows as "skipped" in the
// run's summary, never reported as a pass) — this codebase's Supabase
// project isn't provisioned in every environment this suite runs in
// (SUBAGENT.md "Never invent" applies the same way to test results: a test
// that can't actually run must say so, not report a fake green).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.STORAGE_BUCKET;
const hasCreds = Boolean(url && serviceRoleKey && bucket);

if (!hasCreds) {
  console.log(
    "[storage] SKIPPING supabase-driver.contract.test.ts — NEXT_PUBLIC_SUPABASE_URL / " +
      "SUPABASE_SERVICE_ROLE_KEY / STORAGE_BUCKET are not all set. See .env.example.",
  );
}

describe.skipIf(!hasCreds)("createSupabaseStorageDriver (real bucket)", () => {
  const probeKey = `_storage_driver_contract_test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;

  it("put() then get() round-trips real bytes and content-type through the real API", async () => {
    process.env.STORAGE_DRIVER = "supabase";
    const driver = createSupabaseStorageDriver();
    const bytes = Buffer.from("riverline supabase storage contract probe", "utf8");

    await driver.put(probeKey, bytes, "text/plain");
    const result = await driver.get(probeKey);

    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.contentType).toBe("text/plain");
  });

  it("exists() reflects the real bucket state", async () => {
    const driver = createSupabaseStorageDriver();
    expect(await driver.exists(probeKey)).toBe(true);
    expect(await driver.exists(`${probeKey}-never-written`)).toBe(false);
  });

  it("put() with upsert semantics: re-writing the same key is a safe no-op, not a 409", async () => {
    const driver = createSupabaseStorageDriver();
    const bytes = Buffer.from("second write, same key", "utf8");
    await expect(driver.put(probeKey, bytes, "text/plain")).resolves.toBeUndefined();
    expect((await driver.get(probeKey)).bytes.equals(bytes)).toBe(true);

    // Clean up directly via the raw client (StorageDriver has no delete —
    // deliberately out of scope per the task's interface, see
    // src/shared/storage/types.ts).
    const client = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
    await client.storage.from(bucket!).remove([probeKey]);
  });

  it("get() throws for a key that was never written", async () => {
    const driver = createSupabaseStorageDriver();
    await expect(driver.get(`_storage_driver_contract_test/never-written-${Date.now()}.txt`)).rejects.toThrow();
  });
});
