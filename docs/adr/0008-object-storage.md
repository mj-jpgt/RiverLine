# 0008 — Pluggable object storage (local + Supabase drivers)

Status: Accepted
Date: 2026-08-18

## Context

`docs/deploy/vercel-notes.md` names one concrete blocker to deploying on
Vercel: four sites wrote photo bytes, archived letter HTML, and estimate
document pages straight to the local filesystem under
`uploads/<jurisdictionId>/...` (`UPLOADS_ROOT = path.join(process.cwd(),
"uploads")`), and four sites read them back the same way:

- `app/api/capture/sync/route.ts` — photo bytes (write)
- `app/api/photos/[id]/route.ts` — photo bytes (serve)
- `src/modules/a4-estimates/actions.ts` — estimate document pages (write)
- `app/api/estimates/document/[estimateId]/image/[pageIndex]/route.ts` —
  estimate document pages (serve)
- `src/modules/a1-letters/actions.ts` — archived letter HTML (write)
- `src/modules/a1-letters/queries.ts` — archived letter HTML (serve, via
  `readArchivedLetterHtml`, consumed by `app/letters/[clientId]/print/route.ts`)

Vercel serverless functions have no persistent, writable, shared filesystem
across invocations — this app's own `docs/journal/2026-08-17-c3-capture.md`
flagged the swap-in point at write time: "Swapping this for real object
storage later... is a drop-in change to `writePhotoFile()`... nothing else
depends on the filesystem specifically." Build spec §2.4 already names the
target: Supabase Storage / an S3-compatible bucket, content-hashed (SHA-256)
at upload.

## Decision

A minimal storage interface, `src/shared/storage/types.ts`:

```ts
export interface StorageDriver {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Buffer; contentType: string }>;
  exists(key: string): Promise<boolean>;
}
```

Two drivers, selected per-call (not cached) from `STORAGE_DRIVER`
(`src/shared/storage/index.ts`'s `getStorageDriver()`):

- **`local`** (default) — `src/shared/storage/local.ts`. Writes/reads under
  `process.cwd()/uploads/<key>`, the exact path every write/read site
  already used. Byte-identical to the pre-existing behavior: a file synced
  before this module existed reads back exactly the same way, because the
  key format (content-hash-based for photos/estimate pages, `letters/<jid>/
  <letterId>.html` for letters) is completely unchanged — this task changed
  *what writes and reads the bytes*, never the keys themselves. Content-type
  isn't stored anywhere on the filesystem (no sidecar-metadata scheme was
  invented for this), so `get()` derives it from the key's extension
  (`.jpg`→`image/jpeg`, `.html`→`text/html`) — correct for every key this
  app actually produces, including ones written before this driver existed.
- **`supabase`** — `src/shared/storage/supabase.ts`. Uses the
  already-installed `@supabase/supabase-js` (2.112.3 — ADR 0001; no new
  dependency). Bucket name from `STORAGE_BUCKET`. Authenticates with
  `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never a `NEXT_PUBLIC_*`
  var) against `NEXT_PUBLIC_SUPABASE_URL` (the URL itself isn't sensitive;
  only the key is). `put()` calls `upload(key, bytes, { contentType,
  upsert: true })` — `upsert: true` because `upload()` defaults to `false`
  and would 409 on a field-device's retried, content-addressed write, which
  the local driver's plain `writeFile` overwrite never did. `get()` calls
  `download(key)` and reads `Blob.type` for content-type (Storage returns
  the type it was uploaded with) and `Blob.arrayBuffer()` for bytes.
  `exists()` uses the SDK's own `exists(path)` method.

  Method signatures verified against the real, installed package source —
  not recalled — see "Sources" below.

Every one of the six write/read call sites now calls
`getStorageDriver().put(...)` / `.get(...)` instead of `node:fs/promises`
directly; the surrounding logic (hash re-verification, RLS/`withTenant`
scoping, idempotent-retry handling, role gates) is untouched.

### Why serving stays an authenticated proxy, not a public/signed bucket URL

`app/api/photos/[id]/route.ts` and the estimates image route still resolve
`storage_key` through `withTenant` (RLS-scoped — the cross-tenant-access
proof in `test/unit/security/photo-idor.test.ts` is unaffected, since the
query it exercises is one line above the storage read and never touched)
and stream the bytes back through this server. This task deliberately did
**not** switch to `getPublicUrl()` (would leak every photo publicly — the
build spec's evidentiary photos/letters behind a legal determination) or to
`createSignedUrl()` (would still require an authenticated request to *mint*
the URL, so the security posture is close, but it moves the auth boundary
from "every byte flows through this app's own auth+RLS check" to "one
signed link, valid for N seconds, then unauthenticated" — a real change in
threat model that AGENTS.md's rule 7/8 discipline argues should get its own
explicit sign-off, not ride along inside a storage-backend swap). This is
future work, not implemented here — a signed-URL variant would reduce
server bandwidth (bytes flow client→CDN, not client→this server→bucket→this
server), which matters more as photo/letter volume grows, but it's a
deliberate, separate decision.

### Vercel implication

`STORAGE_DRIVER=supabase` in Vercel's project env vars removes the one
concrete blocker `docs/deploy/vercel-notes.md` names — see that doc's
storage section, now flipped from "blocker" to "resolved."

### Local dev

Unchanged. `STORAGE_DRIVER` unset defaults to `local`, which is the exact
behavior every existing dev/test workflow already depended on — nothing in
`.env.local`, `docker-compose.yml`, or any test needs to change.

## Consequences

- `.env.example` gains `STORAGE_DRIVER` (default `local`) and
  `STORAGE_BUCKET` (only read by the supabase driver), additive — no
  existing var renamed or removed.
- A Supabase Storage bucket used with this driver must be **private** —
  the authenticated-proxy design above assumes it; a public bucket would
  make every photo/letter fetchable by URL with no auth check at all.
- `readArchivedLetterHtml`'s own signature (`Promise<string>`, consumed by
  `app/letters/[clientId]/print/route.ts`, outside this task's paths) is
  unchanged — it now gets its bytes from `StorageDriver.get()` internally
  and converts to a UTF-8 string, same as before.
- No delete/remove operation exists on `StorageDriver` — none of the four
  original sites ever deleted a photo/letter/estimate page, so none was
  added; the Supabase contract test cleans up its own probe object directly
  via the raw SDK client, not through the interface.
- `getStorageDriver()` re-reads `STORAGE_DRIVER` (and, for the supabase
  path, `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/
  `STORAGE_BUCKET`) on every call rather than caching a driver instance —
  each construction is cheap (a closure, or `createClient()` with no
  network call), and this keeps a serverless cold start honest about
  current env rather than risking a stale cached choice.

## Sources (retrieved 2026-08-18)

- `node_modules/.pnpm/@supabase+storage-js@2.112.3/node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts`
  — read directly for `upload()`, `download()`, `exists()` signatures,
  `FileOptions` shape (`contentType`, `upsert`, default `upsert: false`),
  and return shapes (`{ data, error }`).
- `node_modules/.pnpm/@supabase+storage-js@2.112.3/node_modules/@supabase/storage-js/src/packages/BlobDownloadBuilder.ts`
  — read directly to confirm `download()` returns a thenable
  (`BlobDownloadBuilder implements Promise<DownloadResult<Blob>>`), so
  `await ...download(path)` resolves to `{ data: Blob | null, error }`
  without an extra `.then()`/builder step, and that `data.blob()` (called
  internally) yields the real `Blob` whose `.type`/`.arrayBuffer()` this
  driver reads.
- `docs/deploy/vercel-notes.md` — the blocker statement and the four
  original filesystem sites, read directly (a fifth/sixth site,
  `src/modules/a4-estimates/actions.ts` and `src/modules/a1-letters/queries.ts`,
  were found by reading the four named files' own imports/callers — the
  actual `node:fs` calls for "the upload route" and "letter HTML" live one
  level down from the route/action files that doc names).
- `docs/riverline-sdd-build-spec.md` §2.4 — Supabase Storage / S3-compatible
  bucket, SHA-256 content-hash requirement.
- `schema/core.sql` — `photos.storage_key`, `letters.pdf_storage_key`,
  `estimates.storage_key` are opaque `text` columns already, confirming no
  schema change was needed (per this task's constraint — `schema/core.sql`
  is frozen).
