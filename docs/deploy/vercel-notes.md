# Vercel: not currently supported

Build spec §2.8 lists Vercel as an option alongside a self-hosted VPS. Having
now built and proven the VPS/Docker path (`docs/deploy/self-host.md`), the
honest assessment is: **Vercel does not work today, and won't until one
piece of work — real object storage — happens first.** This doc says exactly
what's blocking it and what changes when it's done. No workaround is
pretended here; the recommendation until then is self-host.

## The actual blocker: filesystem uploads

Photo bytes, generated letter files, and estimate-document uploads are all
written to the local filesystem, not object storage — a deliberate MVP
shortcut, documented at the time it was made:

- `app/api/capture/sync/route.ts` — photo bytes, `uploads/<jurisdiction_id>/<sha256>.jpg`
- `src/modules/a1-letters/actions.ts` / `queries.ts` — rendered letters, `uploads/letters/<jurisdiction_id>/<letterId>.html`
- `app/api/photos/[id]/route.ts` — reads photos back from the same tree
- The A4 contractor-estimate-intake module (`app/api/estimates/`,
  `src/modules/a4-estimates/`, in progress as of this writing) follows the
  same `UPLOADS_ROOT` filesystem pattern for uploaded estimate documents —
  same blocker, same fix, once it lands

All of them resolve against `UPLOADS_ROOT = path.join(process.cwd(), "uploads")`
and were explicitly called out as a swap-in point when written — see
`docs/journal/2026-08-17-c3-capture.md` → "Photo storage decision":
"Swapping this for real object storage later (S3, Supabase Storage) is a
drop-in change to `writePhotoFile()` ...; nothing else depends on the
filesystem specifically."

Vercel's serverless functions have no persistent, writable, shared
filesystem across invocations or instances (each invocation may run on a
different, ephemeral instance). Every one of the routes above would either
fail outright or silently lose data (write succeeds against one instance's
ephemeral disk, then a later read on a different instance 404s) the moment
this app ran on Vercel instead of a long-lived container. This is not a
performance concern to tune around — it is a correctness/data-loss problem,
and for this project specifically (`photos`, `letters` — the evidentiary
record behind a legal determination) an unacceptable one.

## What would have to change

1. **Wire up real object storage** for the four write paths above — build
   spec §2 already names the intended target: Supabase Storage or an
   S3-compatible bucket, content-hashed (SHA-256) at upload, same as today's
   filesystem scheme (the hash-based addressing carries over unchanged).
   This needs an ADR (AGENTS.md rule 3 — new dependency: an S3 client, or
   `@supabase/storage-js` if going the Supabase-Storage route) and touches
   exactly the four files listed above plus their tests.
2. **`schema/core.sql` is unaffected** — `photos.storage_key` and the
   letters/estimates equivalents are already opaque string keys, not
   filesystem-path-shaped in a way that assumes a local disk. No schema
   change, per the journal note above.
3. **Migrations**: Vercel has no long-lived container to run
   `docker-entrypoint.sh`'s boot-time migration step in. `scripts/db/migrate.mjs`
   would need to run from a separate context — a deploy-hook / CI step, or a
   one-off `vercel exec` / GitHub Action step — before traffic shifts to the
   new deployment. The advisory-lock fix (`scripts/db/migrate.mjs`, T-W4)
   still matters here, arguably more: a Vercel deploy can trigger multiple
   build/deploy pipelines in parallel far more easily than a single VPS ever
   would.
4. **Database**: build spec already assumes Supabase-hosted Postgres in
   production (`docker-compose.yml`'s local Postgres is dev/test-only per
   `docs/adr/0004`) — this part needs no change for a Vercel move, only for
   a VPS move (where you'd point `DATABASE_URL` at self-hosted Postgres
   instead, as `docker-compose.prod.yml` does).
5. **Auth/session**: magic-link + signed session cookie
   (`src/core/auth/`) has no filesystem dependency and no dependency on a
   long-lived process — this part is already Vercel-compatible as written.
6. **HTTPS**: free on Vercel (every deployment gets one automatically) —
   this actually removes a piece of work relative to self-hosting (no Caddy
   config, no ACME).
7. **B4 (email transport, `docs/BLOCKERS.md`)** is orthogonal to Vercel vs.
   self-host — it blocks production login either way and needs to be
   resolved regardless of hosting choice.

## Recommendation

Self-host (`docs/deploy/self-host.md`) for now — proven, working, matches
what build spec §2.8 calls the fallback for "a jurisdiction demands it," and
sidesteps the storage rewrite entirely since a VPS's filesystem really is
persistent and shared across the one long-lived container. Revisit Vercel
once object storage is wired up for another reason (e.g. it becomes
necessary for horizontal scaling) — at that point Vercel becomes a real
option with no filesystem blocker left, not before.
