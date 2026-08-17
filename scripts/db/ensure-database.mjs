#!/usr/bin/env node
// Shared helper: given a full postgres connection string, make sure the
// target database exists (CREATE DATABASE if missing), connecting via the
// same host/credentials but against the `postgres` maintenance database.
// Used by scripts/db/seed.mjs (--test) and by the RLS test suite's
// beforeAll (test/unit/db/rls.test.ts) to stand up `riverline_test` for real
// against the local Postgres container, rather than assuming it exists.

import pg from "pg";

export function deriveDatabaseName(connectionString) {
  const lastSlash = connectionString.lastIndexOf("/");
  const dbAndQuery = connectionString.slice(lastSlash + 1);
  return dbAndQuery.split("?")[0];
}

export function withDatabaseName(connectionString, dbName) {
  const lastSlash = connectionString.lastIndexOf("/");
  const query = connectionString.slice(lastSlash + 1).includes("?")
    ? "?" + connectionString.slice(lastSlash + 1).split("?")[1]
    : "";
  return `${connectionString.slice(0, lastSlash)}/${dbName}${query}`;
}

export async function ensureDatabaseExists(connectionString, { log = console.log } = {}) {
  const targetDb = deriveDatabaseName(connectionString);
  const maintenanceUrl = withDatabaseName(connectionString, "postgres");

  const client = new pg.Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDb]);
    if (rows.length === 0) {
      log(`Creating database ${targetDb} ...`);
      // Database names cannot be parameterized; targetDb is derived from our
      // own trusted config (DATABASE_URL / --test convention), never from
      // user input. Quote as a Postgres identifier defensively anyway.
      const quoted = `"${targetDb.replace(/"/g, '""')}"`;
      await client.query(`CREATE DATABASE ${quoted}`);
    }
  } finally {
    await client.end();
  }
}
