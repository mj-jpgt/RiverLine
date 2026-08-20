// Supabase Storage driver — unblocks the Vercel deploy (docs/deploy/vercel-notes.md):
// serverless functions have no persistent shared filesystem, Supabase Storage
// does. Uses the already-installed @supabase/supabase-js (no new dependency,
// build spec §2.4 already names Supabase Storage as the target). Method
// signatures below verified against the installed package's own source
// (node_modules/.pnpm/@supabase+storage-js@2.112.3/.../StorageFileApi.ts),
// not recalled — see docs/adr/0008-object-storage.md "Sources".
//
// Auth: the service-role key is required (never the anon key) because
// serving/writing here happens after this app's own auth+tenant checks have
// already run (src/core/auth, withTenant/RLS) — Storage-level RLS policies
// are not layered on top; this app IS the access-control layer, same
// authenticated-proxy posture the filesystem driver always had. The
// service-role key must only ever be read here, server-side — never via a
// NEXT_PUBLIC_* env var.
import { createClient } from "@supabase/supabase-js";
import type { StorageDriver, StoredObject } from "./types";

export function createSupabaseStorageDriver(): StorageDriver {
  // F2 (2026-08-19): trim every value read here — a stray invisible
  // character (a leading UTF-8 BOM was the actual live incident; see
  // src/shared/storage/index.ts's normalizeEnvValue comment for the full
  // story) on any of these three is otherwise either a confusing runtime
  // throw deep inside the Supabase SDK's own header handling (the service
  // role key) or a URL constructor failure (the URL) — neither points
  // anywhere near "check for a stray byte in this env var."
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.STORAGE_BUCKET?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. See .env.example and docs/adr/0008-object-storage.md.",
    );
  }
  if (!bucket) {
    throw new Error("STORAGE_BUCKET is not set. See .env.example and docs/adr/0008-object-storage.md.");
  }

  // persistSession: false — this is a server-only, per-request/per-process
  // client with no browser session to persist (same reasoning any
  // service-role server client uses).
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const files = client.storage.from(bucket);

  return {
    async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
      // upsert: true — same "safe no-op on a retried write" contract the
      // local driver gives content-addressed keys; upload() defaults to
      // upsert: false, which would 409 on a field-device retry.
      const { error } = await files.upload(key, bytes, { contentType, upsert: true });
      if (error) throw error;
    },

    async get(key: string): Promise<StoredObject> {
      const { data, error } = await files.download(key);
      if (error || !data) {
        throw error ?? new Error(`Supabase Storage: "${key}" not found in bucket "${bucket}".`);
      }
      const bytes = Buffer.from(await data.arrayBuffer());
      return { bytes, contentType: data.type || "application/octet-stream" };
    },

    async exists(key: string): Promise<boolean> {
      // Unlike put()/get(), the SDK's exists() always returns a real
      // boolean in `data` (its return type is `data: boolean` in BOTH the
      // success and error branches, deliberately — see the installed
      // source's own comment: "HEAD requests produce StorageApiError...
      // or StorageUnknownError"). A missing key surfaces as a non-null
      // `error` alongside `data: false` for either a 404 OR (verified
      // against the real hosted API, not just the SDK's own handling) a
      // 400 Bad Request for some missing nested-path cases — so `error`
      // here is not itself a failure signal the way it is for put()/get();
      // only `data` is authoritative.
      const { data } = await files.exists(key);
      return data;
    },
  };
}
