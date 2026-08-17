// Internal only — never re-exported from src/shared/db/index.ts. Feature
// code (core modules, app routes) must go through withTenant()/withSystem()
// in ./client, never touch a raw pg.Pool or pg.Client directly. This keeps
// "every request-scoped query sets app.jurisdiction_id" a structural
// property of the codebase, not a convention someone can forget.
import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. See .env.example and docs/adr/0004-migrations-and-local-db.md.",
      );
    }
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}
