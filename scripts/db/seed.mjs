#!/usr/bin/env node
// pnpm exec node scripts/db/seed.mjs [--test]
//
// Seeds a real "Demo City" jurisdiction: nfip_cid and ordinance_citation are
// left NULL on purpose (specs/constitution.md #2 — these are honest empty
// states other modules must handle explicitly, never fabricated). Also
// seeds the built-in practice structure "123 Practice Ln"
// (docs/riverline-sdd-build-spec.md §6.7 — training never touches real
// records) and one admin/assessor/official demo user.
//
// This is a real row in a real database, not a mock (constitution §6 note)
// — AGENTS.md rule 6 still applies: it only ever seeds `*_dev` or `*_test`
// databases, never production. --test targets riverline_test (creating it
// first if it doesn't exist, and applying migrations to it) instead of the
// default DATABASE_URL target.
//
// Idempotent: safe to run repeatedly against the same database.

import pg from "pg";
import { applyMigrations } from "./migrate.mjs";
import { ensureDatabaseExists, withDatabaseName } from "./ensure-database.mjs";

const isTest = process.argv.includes("--test");

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error(
    "BLOCKER: DATABASE_URL is not set. See .env.example and docs/adr/0004-migrations-and-local-db.md.",
  );
  process.exit(1);
}

const targetUrl = isTest ? withDatabaseName(baseUrl, "riverline_test") : baseUrl;

if (isTest) {
  await ensureDatabaseExists(targetUrl);
}
await applyMigrations(targetUrl);

const client = new pg.Client({ connectionString: targetUrl });
await client.connect();

try {
  // --- Demo City jurisdiction -------------------------------------------
  let jurisdictionId;
  {
    const existing = await client.query("select id from jurisdictions where name = $1", [
      "Demo City",
    ]);
    if (existing.rows.length > 0) {
      jurisdictionId = existing.rows[0].id;
      console.log(`Demo City jurisdiction already exists: ${jurisdictionId}`);
    } else {
      const inserted = await client.query(
        `insert into jurisdictions (name, nfip_cid, ordinance_citation, letterhead_config)
         values ($1, null, null, '{}'::jsonb)
         returning id`,
        ["Demo City"],
      );
      jurisdictionId = inserted.rows[0].id;
      console.log(`Created Demo City jurisdiction: ${jurisdictionId}`);
    }
  }

  // --- Demo users ---------------------------------------------------------
  const demoUsers = [
    { email: "admin@example.gov", role: "admin" },
    { email: "assessor@example.gov", role: "assessor" },
    { email: "official@example.gov", role: "official" },
  ];

  for (const u of demoUsers) {
    const result = await client.query(
      `insert into users (email, jurisdiction_id, role)
       values ($1, $2, $3)
       on conflict (email) do nothing
       returning id`,
      [u.email, jurisdictionId, u.role],
    );
    if (result.rows.length > 0) {
      console.log(`Created user ${u.email} (${u.role}): ${result.rows[0].id}`);
    } else {
      console.log(`User ${u.email} already exists.`);
    }
  }

  // --- Practice structure ("123 Practice Ln") ------------------------------
  // Synthetic training fixture, per build spec §6.7 — every value here is a
  // made-up round number for a fictitious address, not a sourced fact about
  // a real structure. Never used as an input to a real determination.
  {
    const parcelId = "DEMO-PRACTICE-001";
    const existing = await client.query(
      "select id from structures where jurisdiction_id = $1 and parcel_id = $2",
      [jurisdictionId, parcelId],
    );
    if (existing.rows.length > 0) {
      console.log(`Practice structure already exists: ${existing.rows[0].id}`);
    } else {
      const inserted = await client.query(
        `insert into structures (
           jurisdiction_id, parcel_id, address, assessor_market_value,
           improvement_value, value_source, value_as_of_date, occupancy_type,
           foundation_type, stories, sq_ft, year_built, prop_class
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning id`,
        [
          jurisdictionId,
          parcelId,
          "123 Practice Ln",
          180000.0,
          140000.0,
          "official_override",
          "2026-01-01",
          "residential",
          "slab",
          1,
          1600,
          1998,
          "PRACTICE",
        ],
      );
      console.log(`Created practice structure "123 Practice Ln": ${inserted.rows[0].id}`);
    }
  }

  console.log(`Seed complete for ${isTest ? "riverline_test" : "DATABASE_URL"}.`);
} finally {
  await client.end();
}
