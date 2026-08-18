# Self-hosting RiverLine SDD

Written for the moment build spec §11.9 describes: a jurisdiction wants to
keep running this tool after the people who built it move on. Everything
below was actually run, against the real files in this repo
(`Dockerfile`, `docker-compose.prod.yml`, `Caddyfile.prod`,
`.env.production.example`, `docker-entrypoint.sh`), not copied from a
template. Where a number appears (build time, image size, boot time) it is
from a real run, not an estimate — see "What was actually proven" at the
bottom for the exact session this came from.

## What you're running

Three containers, one `docker-compose.prod.yml`:

- **`db`** — `postgis/postgis:16-3.4` (Postgres 16 + PostGIS), data in a
  named volume (`pgdata`), not published to the host by default.
- **`app`** — this repo, built by `Dockerfile` (Node 22, `next start`
  against a production build), migrations run automatically on every boot
  (see "Migrations" below), photo/letter storage in a named volume
  (`uploads`).
- **`caddy`** — `caddy:2-alpine`, reverse-proxies HTTPS to `app`, automatic
  Let's Encrypt certificate for a real public hostname (build spec §2.8:
  "HTTPS is non-negotiable: iOS will not grant camera or geolocation
  permissions to insecure origins").

## Prerequisites

- Docker Engine + Docker Compose v2 (verified against Docker 28.5.2 /
  Compose v2.40.3 in this session; anything reasonably current should work).
- A machine reachable on ports 80 and 443 from the internet, with DNS for
  your chosen hostname pointed at it — required for Caddy's automatic HTTPS
  (ACME HTTP-01 challenge) against a real domain. Not required for local
  testing (see `SITE_ADDRESS` below).
- Nothing else. No Node, no pnpm, no Postgres client tools need to be
  installed on the host — everything runs inside the containers.

## First boot

1. Clone the repo, `cd` into it.
2. Copy the env template and fill in real values:

   ```bash
   cp .env.production.example .env.production
   ```

   Generate `SESSION_SECRET` (must be at least 32 chars — enforced in
   `src/core/auth/session.ts`):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Pick a real `POSTGRES_PASSWORD`. Set `SITE_ADDRESS` to your real public
   hostname (e.g. `flood.yourcity.example.gov`) — leave it unset only for
   local testing (see `Caddyfile.prod`'s header comment: an unset/`localhost`
   address gets a self-signed cert from Caddy's internal CA instead of a
   real Let's Encrypt one).

   Every variable, what it does, and which are secrets: see
   `.env.production.example` directly — it is the source of truth, not a
   duplicate table here that can drift out of sync.

3. **Read this before going further — the one thing that will surprise
   you**: as shipped, right now, **no one can log in to a production
   deployment.** `src/core/auth/magic-link.ts`'s `requestMagicLink()`
   deliberately throws in production instead of pretending to send an
   email, because no transactional email provider is wired up yet
   (`docs/BLOCKERS.md` B4). There is no dev-only bypass available in
   production — it is hard-gated off. This stack will build, boot, pass
   every healthcheck below, and serve the login page correctly; submitting
   the sign-in form will 500 until B4 is resolved (pick a provider, write
   the ADR AGENTS.md rule 3 requires, implement the production branch of
   `requestMagicLink()`). Deploy it, verify it, but don't hand it to an
   official yet.

4. Build and start:

   ```bash
   IMAGE_TAG=v0.1.0 docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```

   `IMAGE_TAG` tags the built image `riverline-sdd:v0.1.0` instead of the
   floating `latest` — see "Upgrade and rollback" below for why this
   matters. Pick your own tag scheme (git sha, date, semver); the important
   part is that it's a real, stable tag, not `latest`.

5. Check everything is healthy:

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production ps
   ```

   All three services should show `healthy`. What each healthcheck actually
   asserts (not just "the process exists"):
   - `db`: `pg_isready` against the real database name/user.
   - `app`: a real HTTP GET of `/login` from inside the container, asserting
     a `200` — the Next.js server is actually serving real pages, not just
     that the Node process is running.
   - `caddy`: a real HTTPS GET of `/login` through the proxy (Alpine's
     `wget`, `--no-check-certificate` for the local self-signed-cert case),
     asserting the TLS termination and reverse proxy both work end to end.

6. Visit `https://<your SITE_ADDRESS>/login` (or `https://localhost` for a
   local test with `SITE_ADDRESS` unset — accept the self-signed cert
   warning). You should see the sign-in page.

## Migrations

Migrations are forward-only, numbered SQL files in `migrations/` (AGENTS.md
rule; see `docs/adr/0004-migrations-and-local-db.md`). `docker-entrypoint.sh`
runs `node scripts/db/migrate.mjs` automatically on **every** container
boot, before starting the app — this is intentional and safe to do
unconditionally:

- It's idempotent: only migrations not yet recorded in `schema_migrations`
  get applied; a normal restart with nothing new applies zero migrations.
- It's safe under concurrency: `scripts/db/migrate.mjs` takes a Postgres
  session-level advisory lock (`pg_advisory_lock`) around the whole run, so
  if you ever run more than one `app` replica against the same database and
  both boot at once, the second one blocks until the first finishes
  migrating, then finds nothing left to do. Proven in
  `test/unit/ops/migrate-lock.test.ts` — two concurrent invocations against
  a real scratch database, both succeed, every migration recorded exactly
  once.

To run migrations by hand (e.g. to check what happened without waiting for
a restart):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec app node scripts/db/migrate.mjs
```

`schema/core.sql` is the frozen source of truth (AGENTS.md rule 1) — it is
never applied directly in production; it exists so `migrations/0001_core_schema.sql`
can be checked byte-for-byte identical to it (`test/unit/db/migration-drift.test.ts`).

## Backup and restore

`scripts/ops/backup.mjs` / `scripts/ops/restore.mjs` (already in the image
under `scripts/ops/`) wrap `pg_dump`/`psql` run **inside the running `db`
container** — no Postgres client tools needed on the host. These are the
same scripts proven end-to-end in `test/unit/ops/backup-restore.test.ts`
(real `pg_dump` of a real database, restored into a scratch database, row
counts and a sampled row compared byte-for-byte against the source).

Take a backup:

```bash
DB_CONTAINER=$(docker compose -f docker-compose.prod.yml --env-file .env.production ps -q db) \
DB_BACKUP_DATABASE=${POSTGRES_DB:-riverline} \
DB_BACKUP_USER=${POSTGRES_USER:-riverline} \
  node scripts/ops/backup.mjs
```

Writes a timestamped plain-SQL dump to `backups/` on the host running this
command (gitignored — never commit a backup file; it's real jurisdiction
data). Automate this on a daily cron per build spec §7.5.

**Do a restore drill before you need one for real.** Restore into a scratch
database first, never straight into production:

```bash
DATABASE_URL=postgres://riverline:<password>@localhost:<published-db-port>/postgres \
  node scripts/ops/restore.mjs backups/<timestamp>.sql --target=riverline_restore_check
```

(`docker-compose.prod.yml` doesn't publish the `db` port to the host by
default — temporarily add a `ports:` entry under `db:` to run this from
outside the containers, or run the restore from inside a one-off container
on the same Docker network.) `restore.mjs` refuses to target the real
production database name without an explicit `--force` flag — that
protection exists on purpose; don't route around it by guessing the flag
unless you mean to overwrite production.

## Uploaded-files volume

Photos and generated letter PDFs/HTML live under `/app/uploads` inside the
`app` container, backed by the `uploads` named volume — this is filesystem
storage, not object storage (see `docs/deploy/vercel-notes.md` for why that
matters if you ever consider moving off a VPS). Back it up alongside the
database:

```bash
docker run --rm \
  -v riverline_uploads:/data \
  -v "$(pwd)/backups":/backup \
  alpine tar czf /backup/uploads-$(date +%Y-%m-%dT%H-%M-%S).tar.gz -C /data .
```

(Volume name is `<project-name>_uploads` — `riverline_uploads` if you ran
`docker compose` from a directory named `riverline` with no `-p` override;
check the real name with `docker volume ls`.)

## Where data lives

- Structured data (structures, assessments, calculations, determinations,
  letters metadata, audit log): the `db` container's `pgdata` volume.
- Photo bytes and rendered letter files: the `app` container's `uploads`
  volume.
- Nothing lives outside these two volumes plus your `.env.production` file
  (secrets) and whatever image tags you've built. Losing the host but
  keeping backups of both volumes plus `.env.production` is a full recovery.

## Exporting everything (public-records reality, build spec §7.6)

The administrator dashboard's full export (A2 — `/dashboard/export/full`,
role-gated to admin) produces a ZIP containing every record for the
jurisdiction, in a form suitable for answering an Indiana APRA records
request without needing this codebase or its database at all. This is the
"answer a records request" path — the `pg_dump` backup above is for
disaster recovery, not this. Use the dashboard, not a database export, when
someone actually files a records request.

## Upgrade and rollback

Because `docker-compose.prod.yml`'s `app` service declares both `image:
riverline-sdd:${IMAGE_TAG:-latest}` and a `build:`, a specific `IMAGE_TAG`
gives you a real, addressable, rollback-able artifact instead of a floating
tag (build spec §11.1: "tag every deploy; keep the previous version one
command away").

**Upgrade:**

```bash
git pull
IMAGE_TAG=v0.2.0 docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

This builds and tags the new image, replaces the `app` container, and runs
migrations automatically on boot (forward-only — there is no down-migration
path, by design; see `docs/adr/0004-migrations-and-local-db.md`).
`db` and `caddy` are untouched unless their own images/config changed.

**Rollback**, because you kept the previous tag:

```bash
IMAGE_TAG=v0.1.0 docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

No `--build` — Compose reuses the already-built `riverline-sdd:v0.1.0`
image. **Caveat that matters more here than the container swap itself:**
migrations are forward-only. If `v0.2.0` shipped a migration, rolling the
app container back to `v0.1.0` does **not** roll back the schema — the
old code now runs against a newer schema. For most additive migrations
(new column, new table) this is harmless; for anything else, a real
rollback means restoring the pre-upgrade database backup too (see "Backup
and restore" above), not just swapping the image tag. Take a backup
immediately before every upgrade that includes a new migration file.

## What was actually proven

Run in this session, against a real (but throwaway, isolated) instance —
see `docs/journal/2026-08-17-w4-deploy.md` for the full transcript this
summarizes:

- `docker build`: **232s** cold (no cache), real multi-stage build
  (`deps` → `build` → `runner`), final `app` image **2.55 GB**.
- `docker compose ... up -d --build` against a **fresh** `db` volume: all
  three services reached `healthy`; `app` logs showed migrations
  0001–0004 applied for the first time, then `Ready in 1511ms`.
- `db` container: `\dt` listed every core table (`structures`,
  `assessments`, `calculations`, `determinations`, `letters`, `audit_log`,
  `login_tokens`, `schema_migrations`, ...) — the real frozen schema,
  really applied, not asserted from logs alone.
- `GET https://localhost:8443/login` through the Caddy proxy (host ports
  remapped to 8080/8443 for this throwaway run so the shared dev Postgres
  container other agents were using on 5432 was never touched) returned
  **HTTP 200** with real page HTML.
- Torn down with `docker compose down -v` afterward — volumes, network, and
  containers removed; the shared `riverline-db-1` dev container (unrelated
  to this stack) was confirmed still `healthy` and untouched throughout.

## Known follow-up: `next.config.ts` `output: 'standalone'`

`Dockerfile`'s runner stage currently ships a full `node_modules` (prod +
dev dependencies — see the Dockerfile's own comment on why `pnpm prune
--prod` was tried and reverted: `next start` transpiles `next.config.ts` at
**boot**, which needs `typescript` present, and pruning devDependencies
broke that with a real `ERR_PNPM_UNEXPECTED_STORE` boot failure). This is
why the image is 2.55 GB instead of the couple-hundred-MB a standalone
build would produce.

The fix is a one-line change, deferred only because `next.config.ts` was
owned by a different concurrent workstream during the session that produced
this image and was off-limits to edit:

```diff
 const nextConfig: NextConfig = {
   reactStrictMode: true,
+  output: "standalone",
 };
```

With that line in place, the corresponding `Dockerfile` runner stage would
instead copy `.next/standalone` and `.next/static` (Next.js prunes and
traces the exact runtime dependency graph itself — no `pnpm install` or
`pnpm prune` in the runner stage at all), and `CMD` would become
`["node", "server.js"]` instead of `["node_modules/.bin/next", "start"]`.
Whoever picks this up next: make that config change, then follow Next.js's
own documented standalone Dockerfile pattern for the runner stage rewrite,
and re-run the full prove-out in this doc to get fresh, real numbers.
