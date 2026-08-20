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

// F2 (2026-08-19, docs/journal/2026-08-18-f2-sync.md): the live Vercel
// deployment's STORAGE_DRIVER value carried a leading UTF-8 byte-order-mark
// character (U+FEFF — likely from a `vercel env add` invocation piped from
// a PowerShell `Out-File`/`Set-Content` default-UTF8-with-BOM write; this
// tool's own PowerShell instructions flag that exact default). The switch
// below never matched the corrupted value against the literal "supabase"
// case, so every sync with a photo threw "Unknown STORAGE_DRIVER" in
// production — confirmed via `vercel logs` (the error message's char code
// literally printed as 65279 = 0xFEFF) — even though the value looked
// correct in `vercel env ls`, which only shows "Hidden" for sensitive vars
// and never surfaced the stray byte. Trimming here (String.trim() strips
// U+FEFF along with ordinary whitespace, per the ECMAScript spec) means a
// future env var edit that reintroduces invisible leading/trailing
// characters degrades to the value it looks like, instead of a silent full
// outage for every write this app makes to storage.
function normalizeEnvValue(value: string | undefined): string | undefined {
  return value?.trim();
}

export function getStorageDriver(): StorageDriver {
  const driver = normalizeEnvValue(process.env.STORAGE_DRIVER) ?? "local";
  switch (driver) {
    case "local":
      return createLocalStorageDriver();
    case "supabase":
      return createSupabaseStorageDriver();
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}". Expected "local" or "supabase".`);
  }
}
