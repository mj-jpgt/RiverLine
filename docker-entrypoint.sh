#!/bin/bash
# Production container entrypoint. Runs migrations on every boot, then execs
# the real command (next start). Idempotent: scripts/db/migrate.mjs only
# applies migrations not yet recorded in schema_migrations, and (per the
# T-W4 advisory-lock fix) serializes against any other concurrent instance
# migrating the same database — safe to run on every container start,
# including a multi-replica rolling deploy where more than one instance
# boots against the same Postgres at once.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "BLOCKER: DATABASE_URL is not set. See docs/deploy/self-host.md." >&2
  exit 1
fi

if [ -z "${SESSION_SECRET:-}" ]; then
  echo "BLOCKER: SESSION_SECRET is not set. See docs/deploy/self-host.md." >&2
  exit 1
fi

echo "[entrypoint] waiting for the database to accept connections..."
# docker-compose.prod.yml's `depends_on: condition: service_healthy` already
# gates container start on the db's own healthcheck, but retry defensively
# here too — this image is also meant to be runnable standalone against an
# external/managed Postgres with no compose healthcheck to rely on.
ATTEMPTS=0
MAX_ATTEMPTS=30
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
"; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "BLOCKER: database did not become reachable after ${MAX_ATTEMPTS} attempts." >&2
    exit 1
  fi
  echo "[entrypoint] database not ready yet (attempt ${ATTEMPTS}/${MAX_ATTEMPTS}), retrying in 2s..."
  sleep 2
done

echo "[entrypoint] running migrations..."
node scripts/db/migrate.mjs

echo "[entrypoint] migrations complete, starting app: $*"
exec "$@"
