import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import { withTenant } from "../../../src/shared/db/client";

// Real Postgres, real RLS, no mocks — same recipe as test/unit/db/rls.test.ts
// (T-C1), applied to the specific IDOR question this task calls out:
// app/api/photos/[id]/route.ts resolves a photo purely by its `id` (a UUID
// path param, no other scoping in the URL) and relies entirely on
// `withTenant(jurisdictionId, userId, ...)` + RLS to keep tenant A from
// resolving tenant B's photo id. This test exercises the EXACT query that
// route runs (`select storage_key from photos where id = $1`) against a
// real cross-tenant id, proving the row is invisible rather than merely
// "not returned by app-level filtering" (AGENTS.md "data / backend agents"
// rule 1: application-level filtering is not sufficient).
//
// No route.ts import here — same documented reason as
// test/unit/modules/a3/export-integration.test.ts (cookies()/next-headers
// needs a real request context this suite doesn't have); the route itself
// is two lines around this exact query (see file header there for the
// underlying justification, and docs/security-review.md "IDOR probe" for
// why this is the mechanism actually being proven, not a proxy for it).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. This suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionAId: string;
let jurisdictionBId: string;
let userAId: string;
let userBId: string;
let photoBId: string;
let photoAId: string;

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const jA = await admin.query(
    `insert into jurisdictions (name) values ('Photo IDOR Test Jurisdiction A') returning id`,
  );
  jurisdictionAId = jA.rows[0].id;
  const jB = await admin.query(
    `insert into jurisdictions (name) values ('Photo IDOR Test Jurisdiction B') returning id`,
  );
  jurisdictionBId = jB.rows[0].id;

  const uA = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor') returning id`,
    [`photo-idor-a-${Date.now()}@example.gov`, jurisdictionAId],
  );
  userAId = uA.rows[0].id;
  const uB = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor') returning id`,
    [`photo-idor-b-${Date.now()}@example.gov`, jurisdictionBId],
  );
  userBId = uB.rows[0].id;

  const sA = await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, value_source)
     values ($1, 'IDOR-TEST-A-1', '1 Tenant A St', 'appraisal') returning id`,
    [jurisdictionAId],
  );
  const sB = await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, value_source)
     values ($1, 'IDOR-TEST-B-1', '1 Tenant B St', 'appraisal') returning id`,
    [jurisdictionBId],
  );

  const asmtA = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id)
     values ($1, $2, $3, $4) returning id`,
    [sA.rows[0].id, jurisdictionAId, userAId, `photo-idor-client-a-${Date.now()}`],
  );
  const asmtB = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id)
     values ($1, $2, $3, $4) returning id`,
    [sB.rows[0].id, jurisdictionBId, userBId, `photo-idor-client-b-${Date.now()}`],
  );

  const photoA = await admin.query(
    `insert into photos (assessment_id, jurisdiction_id, storage_key, sha256)
     values ($1, $2, $3, $4) returning id`,
    [asmtA.rows[0].id, jurisdictionAId, `${jurisdictionAId}/tenant-a-secret.jpg`, "a".repeat(64)],
  );
  photoAId = photoA.rows[0].id;

  const photoB = await admin.query(
    `insert into photos (assessment_id, jurisdiction_id, storage_key, sha256)
     values ($1, $2, $3, $4) returning id`,
    [asmtB.rows[0].id, jurisdictionBId, `${jurisdictionBId}/tenant-b-secret.jpg`, "b".repeat(64)],
  );
  photoBId = photoB.rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

// The exact query app/api/photos/[id]/route.ts runs.
async function resolveStorageKeyAs(
  jurisdictionId: string,
  userId: string,
  photoId: string,
): Promise<string | null> {
  return withTenant(jurisdictionId, userId, async (client) => {
    const res = await client.query(`select storage_key from photos where id = $1`, [photoId]);
    return (res.rows[0]?.storage_key as string | undefined) ?? null;
  });
}

describe("IDOR: cross-tenant photo access via app/api/photos/[id]'s exact query", () => {
  it("tenant A cannot resolve tenant B's photo by id — the row is invisible, not filtered", async () => {
    const result = await resolveStorageKeyAs(jurisdictionAId, userAId, photoBId);
    expect(result).toBeNull();
  });

  it("tenant B cannot resolve tenant A's photo by id (symmetric proof, not a one-directional artifact)", async () => {
    const result = await resolveStorageKeyAs(jurisdictionBId, userBId, photoAId);
    expect(result).toBeNull();
  });

  it("tenant A CAN resolve its own photo — proves the block above is tenant isolation, not a broken query", async () => {
    const result = await resolveStorageKeyAs(jurisdictionAId, userAId, photoAId);
    expect(result).toBe(`${jurisdictionAId}/tenant-a-secret.jpg`);
  });

  it("a random/nonexistent photo id resolves to null the same way (no information leak distinguishing 'not yours' from 'does not exist')", async () => {
    const result = await resolveStorageKeyAs(jurisdictionAId, userAId, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});
