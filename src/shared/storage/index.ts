// Public entry point for src/shared/storage — the one place every
// write/serve site in this codebase resolves object storage from. Driver is
// selected per-call from STORAGE_DRIVER (not cached/memoized) so a test can
// flip it between calls without a reset hook, and so a serverless
// invocation always reads current env rather than a stale value baked in at
// cold-start. See docs/adr/0008-object-storage.md.
import { createLocalStorageDriver } from "./local";
import { createSupabaseStorageDriver } from "./supabase";
import type { StorageDriver } from "./types";

export type { StorageDriver, StoredObject } from "./types";
export { createLocalStorageDriver } from "./local";
export { createSupabaseStorageDriver } from "./supabase";

export function getStorageDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      return createLocalStorageDriver();
    case "supabase":
      return createSupabaseStorageDriver();
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}". Expected "local" or "supabase".`);
  }
}
