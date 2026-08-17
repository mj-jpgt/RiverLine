# 0004 — Migrations and local database

Status: Accepted
Date: 2026-08-17

## Context

`schema/core.sql` is the frozen, human-authored source of truth (AGENTS.md
rule 1) and does not exist yet — writing it is explicitly out of scope for
this task. What's needed now is the *machinery*: a local Postgres+PostGIS
that doesn't depend on Supabase being reachable, a forward-only numbered
migration convention, and a `pnpm db:migrate` script — so that whoever
writes `schema/core.sql` (and every agent after them) has somewhere real to
apply it and a runner that already works.

## Options considered

**`node-pg-migrate`** (9.0.0, verified on npm) — a real, maintained
migration framework: up/down migrations, a CLI, a JS/TS migration-authoring
API in addition to raw SQL. More capability than this project uses:
AGENTS.md rule 5 is explicit — "Migrations are forward-only and numbered.
Never edit a shipped migration" — there is no down-migration story in this
project's design at all.

**Plain numbered `.sql` files + a small custom runner script** — no new
npm dependency for the migration *format* (migrations are raw SQL,
runnable directly with `psql` in an emergency, readable by anyone without
knowing a JS migration DSL); a small `scripts/db/migrate.mjs` (Node + `pg`)
applies whatever hasn't been recorded in a `schema_migrations` tracking
table yet, in filename order, each inside its own transaction.

## Decision

Plain SQL files + a small runner. This is the "prefer the boring one"
option the task brief asked for, and it matches what AGENTS.md's migration
rule actually needs (forward-only, numbered, never edited) with nothing
left over. `node-pg-migrate`'s down-migrations, its own CLI, and its
migration-authoring DSL are all capability this project's stated rules
explicitly don't use.

This does add one new runtime dependency: `pg` (8.23.0, the standard,
widely-used node-postgres client) — there's no way to run raw SQL against a
local Postgres without *some* driver, and `pg` is the boring, minimal
choice (a thin client, not an ORM). `@supabase/supabase-js` was considered
as an alternative client but it talks to a hosted Supabase project over
its REST/PostgREST API, not directly to an arbitrary local Postgres
connection string — it's the right client for the app's own Supabase calls
later, not for a local migration runner.

### What was built and verified

- `docker-compose.yml` at repo root, single `db` service:
  `postgis/postgis:16-3.4`. **Image tag existence was verified**, not
  assumed — `docker manifest inspect postgis/postgis:16-3.4` resolved
  successfully before it was written into the compose file.
- Brought the container up in this session (`docker compose up -d db`) —
  Docker Desktop was not running at task start and had to be started first.
  Confirmed `pg_isready`, then confirmed PostGIS itself works, not just the
  base image: `CREATE EXTENSION IF NOT EXISTS postgis; SELECT
  PostGIS_Version();` returned `3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`
  inside the running container.
- `migrations/` directory, forward-only numbered convention:
  `NNNN_description.sql`, four digits, sorted lexically = chronologically.
  Currently empty (only a `.gitkeep`) because there is nothing to migrate
  yet — `schema/core.sql` doesn't exist.
- `scripts/db/migrate.mjs`: reads `DATABASE_URL` from the environment,
  ensures a `schema_migrations(filename, applied_at)` tracking table
  exists, applies any `migrations/*.sql` file not yet recorded, each
  inside `BEGIN`/`COMMIT` (rolling back and exiting nonzero on the first
  failure — it does not attempt to apply files out of order or skip a
  failed one). **Ran this against the real container** in this session:
  with zero migration files present it correctly reports "No migration
  files found ... this is expected and is a known blocker, not an error"
  and exits 0 rather than pretending success or failing on an empty
  directory.
- `.env.example` documents `DATABASE_URL` for the local compose Postgres
  and the (currently empty) Supabase env vars needed once auth/storage
  modules exist.

## Consequences

- `pnpm db:migrate` with no `DATABASE_URL` set fails loudly with setup
  instructions, rather than silently no-op'ing — this is intentional; a
  migration script that can't reach a database should not report success.
- The very first real migration (whenever `schema/core.sql` lands and gets
  translated into `migrations/0001_core_schema.sql` or similar) will be the
  first real exercise of this runner beyond the empty-directory case tested
  here. That is expected and fine — the runner's transaction-per-file /
  rollback-on-failure logic was written defensively for that moment, not
  tested against it (there is nothing to test it against yet).
- Local Postgres via docker-compose is a *development/test* convenience
  only. Production is still Supabase-hosted per the build spec; nothing
  here changes that.

## Sources (retrieved 2026-08-17)

- `docker manifest inspect postgis/postgis:16-3.4` — direct registry check, run in this session, exit 0.
- `npm view node-pg-migrate version` / `npm view pg version` — direct npm registry checks, run in this session.
- AGENTS.md rule 5 (forward-only, numbered, never edit a shipped migration) and rule 1 (`schema/core.sql` frozen) — this repo's own root file.
