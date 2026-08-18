# Vercel: supported (storage blocker resolved 2026-08-18)

Build spec §2.8 lists Vercel as an option alongside a self-hosted VPS. This
doc previously said Vercel would not work until real object storage was
wired up. That work landed 2026-08-18 (`docs/adr/0008-object-storage.md`,
`src/shared/storage/`): the filesystem blocker below is resolved by setting
`STORAGE_DRIVER=supabase` in the Vercel project's env vars. Self-host
(`docs/deploy/self-host.md`) remains a valid option too — nothing about
this change removes it — but it is no longer the only option.

## Resolved: filesystem uploads

Photo bytes, generated letter files, and estimate-document uploads used to
be written to the local filesystem — a deliberate MVP shortcut, documented
at the time it was made, and explicitly called out as a swap-in point
(`docs/journal/2026-08-17-c3-capture.md` → "Photo storage decision"). All
six of the actual read/write sites now go through
`src/shared/storage`'s `StorageDriver` interface instead of `node:fs`
directly:

- `app/api/capture/sync/route.ts` — photo bytes (write)
- `app/api/photos/[id]/route.ts` — photo bytes (serve)
- `src/modules/a4-estimates/actions.ts` — estimate document pages (write)
- `app/api/estimates/document/[estimateId]/image/[pageIndex]/route.ts` — estimate document pages (serve)
- `src/modules/a1-letters/actions.ts` — archived letter HTML (write)
- `src/modules/a1-letters/queries.ts` — archived letter HTML (serve)

Key format (content-hash-based for photos/estimate pages,
`letters/<jurisdictionId>/<letterId>.html` for letters) is completely
unchanged — `photos.storage_key` / `estimates.storage_key` /
`letters.pdf_storage_key` still hold the exact same opaque strings they
always did; `schema/core.sql` was not touched.

### Vercel deploy: exact env vars this needs

Set these in the Vercel project's Environment Variables (Production —
and Preview, if preview deploys should also work, since Preview
deployments are just as serverless/ephemeral-filesystem as Production):

```
STORAGE_DRIVER=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key — server-only secret, never NEXT_PUBLIC_*>
STORAGE_BUCKET=<bucket name, e.g. "uploads">
```

The bucket must be created **private** in Supabase Storage (not the
"public bucket" toggle) — every serving route still authenticates the
request and checks tenant scoping via `withTenant`/RLS before streaming
bytes back through this app's own server (an authenticated proxy, not a
public/signed bucket URL — see ADR 0008's "Why serving stays an
authenticated proxy"). `getStorageDriver()` (`src/shared/storage/index.ts`)
throws immediately, naming exactly which env var is missing, if
`STORAGE_DRIVER=supabase` is set without the other three — this is a fail
loud, not fail silent, misconfiguration.

Everything else `docs/riverline-sdd-build-spec.md` §2 already assumes for
production (Supabase-hosted Postgres via `DATABASE_URL`) is unrelated to
this change and unaffected.

## What still applies on a Vercel deploy

1. **Migrations**: Vercel has no long-lived container to run
   `docker-entrypoint.sh`'s boot-time migration step in. `scripts/db/migrate.mjs`
   would need to run from a separate context — a deploy-hook / CI step, or a
   one-off `vercel exec` / GitHub Action step — before traffic shifts to the
   new deployment. The advisory-lock fix (`scripts/db/migrate.mjs`, T-W4)
   still matters here, arguably more: a Vercel deploy can trigger multiple
   build/deploy pipelines in parallel far more easily than a single VPS ever
   would.
2. **Database**: build spec already assumes Supabase-hosted Postgres in
   production (`docker-compose.yml`'s local Postgres is dev/test-only per
   `docs/adr/0004`) — this part needs no change for a Vercel move, only for
   a VPS move (where you'd point `DATABASE_URL` at self-hosted Postgres
   instead, as `docker-compose.prod.yml` does).
3. **Auth/session**: magic-link + signed session cookie
   (`src/core/auth/`) has no filesystem dependency and no dependency on a
   long-lived process — this part is already Vercel-compatible as written.
4. **HTTPS**: free on Vercel (every deployment gets one automatically) —
   this actually removes a piece of work relative to self-hosting (no Caddy
   config, no ACME).
5. **B4 (email transport, `docs/BLOCKERS.md`)** is orthogonal to Vercel vs.
   self-host — it blocks production login either way and needs to be
   resolved regardless of hosting choice.

## Recommendation

Either Vercel or self-host (`docs/deploy/self-host.md`) is now a real
option — the choice is no longer forced by the storage blocker. Vercel
with `STORAGE_DRIVER=supabase` needs the migration-timing item above
(#1) handled as a deploy-pipeline step; self-host remains the simpler
choice if a jurisdiction specifically wants everything (app + Postgres +
storage) on one box.
