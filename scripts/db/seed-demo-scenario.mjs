#!/usr/bin/env node
// pnpm exec node scripts/db/seed-demo-scenario.mjs [--test | --live]
//
// G2 (training demo scenario). Creates a SECOND, fully self-contained
// jurisdiction — "Riverline Training Demo" — sanctioned explicitly by
// docs/riverline-sdd-build-spec.md §11.3 ("A demo/sandbox jurisdiction...
// This is also your training environment and your regression-test bed.").
// RLS (schema/core.sql) isolates it completely from every real jurisdiction
// ("Demo City" included, seeded by scripts/db/seed.mjs) — a different
// jurisdiction_id is a hard wall, not a convention.
//
// Every string this script writes is unmistakably a training artifact:
// the jurisdiction name, every email domain, every address, every parcel
// id, the ordinance citation text, and the cost table's source_citation
// all say so explicitly. AGENTS.md rule 4/5 ("never invent a fact / never
// write cost values from memory") governs REAL jurisdictions; this
// jurisdiction is the one place fabricated-but-clearly-labeled numbers are
// the whole point — same posture test/fixtures/engine/cost-table.test-fixture-v0.json
// already takes for the test suite, just scoped to a real (visibly-fake)
// jurisdiction instead of *_test databases, because the ask here is a demo
// a human can click through, not a unit-test fixture.
//
// Idempotent: every insert is guarded by a lookup on a natural key first
// (name / email / parcel_id / client_id / calculation count), so running
// this script twice against the same database changes nothing the second
// time. Covered by test/unit/db/seed-demo-scenario.test.ts against
// riverline_test.
//
// Runs against:
//   (default) process.env.DATABASE_URL      — local riverline_dev
//   --test                                   — riverline_test (created + migrated)
//   --live                                   — Supabase, via .env.supabase's
//                                               DATABASE_URL_SESSION + "?sslmode=no-verify"
//                                               (same pattern already used by
//                                               docs/journal/2026-08-18-f1-registry.md
//                                               and .scratch-f2/probe-users.mjs)
//
// Storage (letters archived for the two adopted structures): local
// filesystem (uploads/<key>, matching src/shared/storage/local.ts) unless
// STORAGE_DRIVER=supabase is set (mirrors the app's own getStorageDriver()
// selection) or --live is passed, in which case it uploads via
// @supabase/supabase-js straight to the Supabase Storage bucket, matching
// src/shared/storage/supabase.ts's key convention exactly
// (letters/<jurisdictionId>/<letterId>.html) so the real app can read these
// back through app/letters/ with no special-casing.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "./migrate.mjs";
import { ensureDatabaseExists, withDatabaseName } from "./ensure-database.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const JURISDICTION_NAME = "Riverline Training Demo";
export const EMAIL_DOMAIN = "riverline-training.example";
export const COST_TABLE_VERSION = "TRAINING-DEMO-v1";

// ---------------------------------------------------------------------------
// Engine math, re-implemented here byte-for-byte from src/core/engine
// (calculate.ts + rounding.ts). Scripts under scripts/ never import from
// src/ (no existing script does — see scripts/preprocess/ingest-parcels.mjs,
// which writes structures rows directly with no src/ import either); Node
// cannot import project TypeScript from a plain .mjs without a build step,
// and adding one is exactly the over-engineering AGENTS.md rule 6 forbids
// for a single seed script. Duplicated on purpose, kept intentionally tiny,
// and the formula is quoted verbatim in the comment above each piece so a
// future reader can diff it against the real engine by eye.
// ---------------------------------------------------------------------------

/** ratio = round_half_up((total*100 / market*100) * 10000) / 10000, exact
 * integer arithmetic — mirrors src/core/engine/rounding.ts's ratioBasisPoints. */
function ratioBasisPoints(totalRepairCost, marketValueUsed) {
  if (!(marketValueUsed > 0)) throw new Error("market_value_used must be > 0");
  const totalCents = BigInt(Math.round(totalRepairCost * 100));
  const marketCents = BigInt(Math.round(marketValueUsed * 100));
  const numerator = totalCents * 10000n;
  const quotient = numerator / marketCents;
  const remainder = numerator % marketCents;
  const roundUp = remainder * 2n >= marketCents;
  return roundUp ? quotient + 1n : quotient;
}

/** element repair cost = base_cost_per_sqft[code] * sq_ft * (damage_pct/100);
 * total = sum. Mirrors src/core/engine/calculate.ts's runEngine(). */
function computeTotal(costsForOccupancy, sqFt, damage) {
  let total = 0;
  for (const [code, baseCost] of Object.entries(costsForOccupancy)) {
    const pct = damage[code] ?? 0;
    total += (baseCost * sqFt * pct) / 100;
  }
  return Math.round(total * 100) / 100;
}

function classify(basisPoints) {
  if (basisPoints >= 5500n) return "SD";
  if (basisPoints >= 4500n) return "BORDERLINE";
  return "NOT_SD";
}

/** Picks a market_value_used (rounded to the nearest $1,000, so it reads
 * like a plausible appraisal figure rather than a suspiciously exact
 * quotient) that lands `total`'s ratio close to `targetRatio`, then derives
 * the REAL ratio/threshold from that rounded value via the exact same
 * formula the app uses — never hand-typed, so the stored calculations row
 * is always internally consistent with assessment_elements + cost_table +
 * sq_ft, exactly as app/determination's getReviewDetail() would recompute
 * it live. */
function deriveCalculation(costsForOccupancy, sqFt, damage, targetRatio) {
  const total = computeTotal(costsForOccupancy, sqFt, damage);
  const marketValueUsed = Math.round(total / targetRatio / 1000) * 1000;
  const basisPoints = ratioBasisPoints(total, marketValueUsed);
  return {
    totalRepairCost: total,
    marketValueUsed,
    ratio: Number(basisPoints) / 10000,
    thresholdResult: classify(basisPoints),
  };
}

// ---------------------------------------------------------------------------
// Cost table — TRAINING ONLY. Round, made-up $/sqft figures picked purely so
// the demo's six scenarios land visibly in NOT_SD / BORDERLINE / SD bands.
// Not derived from any cost-estimating guide (docs/BLOCKERS.md B1 — no real
// guide has been procured for ANY jurisdiction yet). source_citation below
// says so in as many words, per the same discipline
// test/fixtures/engine/cost-table.test-fixture-v0.json already established.
// ---------------------------------------------------------------------------
const RESIDENTIAL_COSTS = {
  foundations: 8,
  superstructure: 16,
  roof_covering: 6,
  exterior_finish: 5,
  interior_finish: 9,
  doors_windows: 5,
  cabinets_countertops: 4,
  floor_finish: 6,
  plumbing: 8,
  electrical: 7,
  appliances: 3,
  hvac: 6,
};

const NON_RESIDENTIAL_COSTS = {
  foundations: 10,
  superstructure: 20,
  roof_covering: 7,
  plumbing: 9,
  electrical: 8,
  interiors: 12,
  hvac: 7,
};

const COST_TABLE_SOURCE_CITATION =
  "TRAINING ONLY — illustrative unit costs for the Riverline Training Demo jurisdiction. " +
  "These are round, made-up dollar-per-square-foot figures chosen only to demonstrate the " +
  "NOT_SD / BORDERLINE / SD calculation bands. They are NOT sourced from a licensed cost-estimating " +
  "guide and must never be used as an input to a real substantial-damage determination. " +
  "See docs/BLOCKERS.md B1 for the real procurement requirement this table deliberately does not satisfy.";

const ORDINANCE_CITATION_TEXT =
  "TRAINING SAMPLE, not legal text. The Riverline Training Demo jurisdiction is a training and " +
  "pitch-demo environment (docs/riverline-sdd-build-spec.md §11.3); it is not a real city, town, " +
  "or county, and this paragraph is not a real floodplain ordinance. Sample finding language, for " +
  "demonstration only: “A structure is substantially damaged when the cost to restore it to its " +
  "pre-damage condition equals or exceeds fifty percent (50%) of its market value before the damage " +
  "occurred, as determined by the floodplain administrator.” Do not cite this text for any real " +
  "determination, appeal, or legal purpose.";

const LETTERHEAD_CONFIG = {
  letterhead_name: "Riverline Training Demo (training environment — not a real government office)",
  address_lines: [
    "TRAINING DEMO — no real office exists at this address",
    "123 Sample Municipal Way",
    "Trainingtown, ZZ 00000",
  ],
  appeal_window_days: 30,
};

// ---------------------------------------------------------------------------
// Structures. Every address is "<number> Training Flood Ct" and every
// parcel_id is TRAINING-DEMO-0XX — both scream demo on sight, satisfying
// the "zero plausible-real legal text" requirement for data that lives
// outside test/fixtures/.
// ---------------------------------------------------------------------------
const STRUCTURES = [
  {
    num: "001",
    address: "101 Training Flood Ct",
    occupancy: "residential",
    sqFt: 1500,
    marketValue: 200000,
    improvementValue: 150000,
    foundation: "slab",
    stories: 1,
    yearBuilt: 1995,
    notes: "[TRAINING DEMO] Not yet assessed. Use this one to demo starting a capture from the registry.",
  },
  {
    num: "002",
    address: "102 Training Flood Ct",
    occupancy: "residential",
    sqFt: 1500,
    marketValue: 200000,
    improvementValue: 150000,
    foundation: "crawlspace",
    stories: 1,
    yearBuilt: 1988,
    notes: "[TRAINING DEMO] Mid-capture draft assessment on purpose — shows the auto-save/resume flow.",
  },
  {
    num: "003",
    address: "103 Training Flood Ct",
    occupancy: "residential",
    sqFt: 1500,
    // Matches the derived calculations.market_value_used below exactly, so
    // the registry/dashboard's structure-level value and the calculation
    // screen's value agree — a deliberate consistency choice, not a
    // coincidence (see deriveCalculation()'s comment).
    marketValue: 85000,
    improvementValue: 65000,
    foundation: "slab",
    stories: 1,
    yearBuilt: 2001,
    notes: "[TRAINING DEMO] Completed assessment, calculation done, awaiting official review (NOT_SD range).",
  },
  {
    num: "004",
    address: "104 Training Flood Ct",
    occupancy: "residential",
    sqFt: 1500,
    marketValue: 143000,
    improvementValue: 110000,
    foundation: "crawlspace",
    stories: 2,
    yearBuilt: 1979,
    notes: "[TRAINING DEMO] Completed assessment landing in the BORDERLINE band — forced human review.",
  },
  {
    num: "005",
    address: "105 Training Flood Ct",
    occupancy: "residential",
    sqFt: 1500,
    marketValue: 170000,
    improvementValue: 130000,
    foundation: "slab",
    stories: 1,
    yearBuilt: 1966,
    notes: "[TRAINING DEMO] Adopted SD determination with an issued letter — the full station 4 walkthrough.",
  },
  {
    num: "006",
    address: "106 Training Flood Ct",
    occupancy: "residential",
    sqFt: 1500,
    marketValue: 70000,
    improvementValue: 54000,
    foundation: "slab",
    stories: 1,
    yearBuilt: 2010,
    notes: "[TRAINING DEMO] Adopted NOT_SD determination with an issued letter — the other letter variant.",
  },
  {
    num: "007",
    address: "107 Training Flood Ct",
    occupancy: "non_residential",
    sqFt: 3000,
    marketValue: 239000,
    improvementValue: 200000,
    foundation: "slab",
    stories: 1,
    yearBuilt: 1992,
    notes:
      "[TRAINING DEMO] Adopted SD determination later superseded after a re-inspection correction — shows the audit trail.",
  },
  {
    num: "008",
    address: "108 Training Flood Ct",
    occupancy: "non_residential",
    sqFt: 2500,
    marketValue: 300000,
    improvementValue: 220000,
    foundation: "pier",
    stories: 1,
    yearBuilt: 2005,
    notes: "[TRAINING DEMO] Not yet assessed — spare non-residential structure for browsing the registry.",
  },
];

// ---------------------------------------------------------------------------
// Storage (letters only). Minimal, self-contained re-implementation of
// src/shared/storage's put(), same reasoning as the engine-math duplication
// above: scripts/ never imports src/. Loud watermark ("TRAINING DEMO
// LETTER") distinguishes this from a1-letters' real renderLetterHtml output
// at a glance, even though the storage KEY convention is identical
// (letters/<jurisdictionId>/<letterId>.html) so the real app reads it back
// with no special-casing.
// ---------------------------------------------------------------------------
async function putLocal(key, bytes) {
  const filePath = path.join(process.cwd(), "uploads", key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

async function putSupabase(key, bytes, { url, serviceRoleKey, bucket }) {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const { error } = await client.storage
    .from(bucket)
    .upload(key, bytes, { contentType: "text/html", upsert: true });
  if (error) throw error;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDemoLetterHtml({ jurisdictionName, structureAddress, parcelId, ratioPct, thresholdResult, ordinanceCitation, officialEmail, adoptedDateIso }) {
  const finding =
    thresholdResult === "SD"
      ? `IS substantially damaged (ratio ${escapeHtml(ratioPct)}%, meets or exceeds the 50% threshold)`
      : `IS NOT substantially damaged (ratio ${escapeHtml(ratioPct)}%, below the 50% threshold)`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>TRAINING DEMO letter — ${escapeHtml(structureAddress)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; background: white; color: black; margin: 0; }
  .page { max-width: 44rem; margin: 0 auto; padding: 48px 56px 64px; line-height: 1.55; font-size: 15px; }
  .banner { background: white; color: black; border: 2px solid black; font-family: system-ui, sans-serif;
    font-weight: 700; text-align: center; padding: 10px 16px; margin: 0; }
  .citation { margin: 16px 0; padding: 12px 16px; border-left: 3px solid black; font-style: italic; white-space: pre-wrap; }
  .footer { margin-top: 56px; padding-top: 16px; border-top: 1px solid black; font-size: 11px; font-family: system-ui, sans-serif; }
</style>
</head>
<body>
<p class="banner">TRAINING DEMO LETTER — not a real determination, not legal text</p>
<div class="page">
  <p><strong>${escapeHtml(jurisdictionName)}</strong></p>
  <p>Re: ${escapeHtml(structureAddress)} (Parcel ${escapeHtml(parcelId)})</p>
  <p>Substantial damage / substantial improvement determination (TRAINING EXAMPLE)</p>
  <p>Based on a training assessment, the estimated cost of repair produced a ratio of ${escapeHtml(ratioPct)}%.
     Under the substantial damage threshold of 50% of market value, this training example ${finding}.</p>
  <p>Cited authority (training sample only):</p>
  <p class="citation">${escapeHtml(ordinanceCitation)}</p>
  <p>Adopting official (training account): ${escapeHtml(officialEmail)}</p>
  <p>Date adopted: ${escapeHtml(adoptedDateIso)}</p>
  <div class="footer">
    <p>This is a training artifact generated by scripts/db/seed-demo-scenario.mjs for the Riverline
       Training Demo jurisdiction. It has no legal effect and describes no real property.</p>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Idempotent upsert helpers
// ---------------------------------------------------------------------------

async function upsertJurisdiction(client, log) {
  const existing = await client.query("select id from jurisdictions where name = $1", [JURISDICTION_NAME]);
  if (existing.rows.length > 0) {
    log(`Jurisdiction "${JURISDICTION_NAME}" already exists: ${existing.rows[0].id}`);
    // Keep the ordinance/letterhead in sync even on a re-run (e.g. after this
    // script's text changes) — harmless, both are fully deterministic
    // constants above, never user-edited data this would clobber.
    await client.query(
      `update jurisdictions set ordinance_citation = $1, letterhead_config = $2 where id = $3`,
      [ORDINANCE_CITATION_TEXT, JSON.stringify(LETTERHEAD_CONFIG), existing.rows[0].id],
    );
    return existing.rows[0].id;
  }
  const inserted = await client.query(
    `insert into jurisdictions (name, nfip_cid, ordinance_citation, letterhead_config)
     values ($1, null, $2, $3)
     returning id`,
    [JURISDICTION_NAME, ORDINANCE_CITATION_TEXT, JSON.stringify(LETTERHEAD_CONFIG)],
  );
  log(`Created jurisdiction "${JURISDICTION_NAME}": ${inserted.rows[0].id}`);
  return inserted.rows[0].id;
}

async function upsertCostTable(client, jurisdictionId, log) {
  const existing = await client.query("select version from cost_tables where version = $1", [COST_TABLE_VERSION]);
  if (existing.rows.length > 0) {
    log(`Cost table "${COST_TABLE_VERSION}" already exists.`);
    return;
  }
  await client.query(
    `insert into cost_tables (version, jurisdiction_id, source_citation, effective_date, json_payload)
     values ($1, $2, $3, current_date, $4)`,
    [
      COST_TABLE_VERSION,
      jurisdictionId,
      COST_TABLE_SOURCE_CITATION,
      JSON.stringify({
        base_cost_per_sqft: { residential: RESIDENTIAL_COSTS, non_residential: NON_RESIDENTIAL_COSTS },
      }),
    ],
  );
  log(`Created cost table "${COST_TABLE_VERSION}".`);
}

async function upsertUsers(client, jurisdictionId, log) {
  const users = [
    { email: `demo-assessor@${EMAIL_DOMAIN}`, role: "assessor" },
    { email: `demo-official@${EMAIL_DOMAIN}`, role: "official" },
    { email: `demo-admin@${EMAIL_DOMAIN}`, role: "admin" },
  ];
  const ids = {};
  for (const u of users) {
    const result = await client.query(
      `insert into users (email, jurisdiction_id, role)
       values ($1, $2, $3)
       on conflict (email) do nothing
       returning id`,
      [u.email, jurisdictionId, u.role],
    );
    if (result.rows.length > 0) {
      ids[u.role] = result.rows[0].id;
      log(`Created user ${u.email} (${u.role}): ${result.rows[0].id}`);
    } else {
      const existing = await client.query("select id from users where email = $1", [u.email]);
      ids[u.role] = existing.rows[0].id;
      log(`User ${u.email} already exists.`);
    }
  }
  return ids;
}

async function upsertStructure(client, jurisdictionId, def, log) {
  const parcelId = `TRAINING-DEMO-${def.num}`;
  const existing = await client.query(
    "select id from structures where jurisdiction_id = $1 and parcel_id = $2",
    [jurisdictionId, parcelId],
  );
  if (existing.rows.length > 0) {
    log(`Structure "${def.address}" already exists: ${existing.rows[0].id}`);
    return existing.rows[0].id;
  }
  const inserted = await client.query(
    `insert into structures (
       jurisdiction_id, parcel_id, address, assessor_market_value, improvement_value,
       value_source, value_as_of_date, sfha_zone, firm_panel, occupancy_type,
       foundation_type, stories, sq_ft, year_built, prop_class, notes
     ) values ($1,$2,$3,$4,$5,$6,current_date,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id`,
    [
      jurisdictionId,
      parcelId,
      def.address,
      def.marketValue,
      def.improvementValue,
      "official_override",
      "AE",
      "TRAINING-DEMO-PANEL",
      def.occupancy,
      def.foundation,
      def.stories,
      def.sqFt,
      def.yearBuilt,
      "TRAINING-DEMO",
      def.notes,
    ],
  );
  log(`Created structure "${def.address}": ${inserted.rows[0].id}`);
  return inserted.rows[0].id;
}

async function upsertAssessment(client, jurisdictionId, structureId, assessorUserId, clientId, opts, log) {
  const existing = await client.query("select id from assessments where client_id = $1", [clientId]);
  if (existing.rows.length > 0) {
    log(`Assessment ${clientId} already exists: ${existing.rows[0].id}`);
    return existing.rows[0].id;
  }
  const inserted = await client.query(
    `insert into assessments (
       structure_id, jurisdiction_id, assessor_user_id, started_at, completed_at,
       client_id, water_depth_interior_in, water_depth_source, notes
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id`,
    [
      structureId,
      jurisdictionId,
      assessorUserId,
      opts.startedAt,
      opts.completedAt,
      clientId,
      opts.waterDepthIn,
      opts.waterDepthSource,
      opts.notes,
    ],
  );
  log(`Created assessment ${clientId}: ${inserted.rows[0].id}`);
  return inserted.rows[0].id;
}

/** Sets assessment_elements to exactly `damage` for this assessment —
 * inserts missing codes, updates any that already exist to the given
 * damage_pct (so a second run with the same `damage` map is a true no-op,
 * and a script edit changing the numbers still converges instead of
 * silently keeping stale values from a first run). */
async function setAssessmentElements(client, assessmentId, jurisdictionId, damage, costTableVersion) {
  for (const [code, pct] of Object.entries(damage)) {
    await client.query(
      `insert into assessment_elements (assessment_id, jurisdiction_id, element_code, damage_pct, cost_table_version)
       values ($1,$2,$3,$4,$5)
       on conflict (assessment_id, element_code)
       do update set damage_pct = excluded.damage_pct, cost_table_version = excluded.cost_table_version`,
      [assessmentId, jurisdictionId, code, pct, costTableVersion],
    );
  }
}

/** Inserts a calculations row only if the assessment does not already have
 * `expectedCount` or more calculations — idempotency for the
 * append-only/immutable calculations table (AGENTS.md rule 10: never
 * UPDATE), where "already seeded" can't be checked by natural key the way
 * jurisdictions/users/structures/assessments can. */
async function insertCalculationIfMissing(client, jurisdictionId, assessmentId, calc, expectedCountAfter, log) {
  const countRes = await client.query("select count(*)::int as n from calculations where assessment_id = $1", [
    assessmentId,
  ]);
  const currentCount = countRes.rows[0].n;
  if (currentCount >= expectedCountAfter) {
    log(`Calculation #${expectedCountAfter} for assessment ${assessmentId} already exists.`);
    const existing = await client.query(
      "select id from calculations where assessment_id = $1 order by computed_at asc",
      [assessmentId],
    );
    return existing.rows[expectedCountAfter - 1].id;
  }
  const inserted = await client.query(
    `insert into calculations (
       assessment_id, jurisdiction_id, cost_table_version, total_repair_cost,
       market_value_used, value_source, ratio, threshold_result, engine_version
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id`,
    [
      assessmentId,
      jurisdictionId,
      COST_TABLE_VERSION,
      calc.totalRepairCost,
      calc.marketValueUsed,
      "official_override",
      calc.ratio,
      calc.thresholdResult,
      "1.0.0",
    ],
  );
  log(`Created calculation #${expectedCountAfter} for assessment ${assessmentId}: ratio ${calc.ratio} (${calc.thresholdResult})`);
  return inserted.rows[0].id;
}

async function insertAdoptedDetermination(client, jurisdictionId, structureId, calculationId, officialUserId, opts, log) {
  const existing = await client.query("select id, status from determinations where calculation_id = $1", [
    calculationId,
  ]);
  if (existing.rows.length > 0) {
    log(`Determination for calculation ${calculationId} already exists (${existing.rows[0].status}).`);
    return existing.rows[0].id;
  }
  // is_local=false (session-scoped, not transaction-scoped): this script
  // issues each statement as its own implicit auto-committed transaction
  // (no explicit BEGIN block), so a `true`/transaction-local set_config
  // would already be gone by the time the very next query runs. Session
  // scope keeps it live for the INSERT immediately below, giving
  // schema/core.sql's audit_determinations() trigger a real actor_user_id
  // instead of null.
  await client.query("select set_config('app.user_id', $1, false)", [officialUserId]);
  const inserted = await client.query(
    `insert into determinations (
       structure_id, jurisdiction_id, calculation_id, status, adopted_by_user_id, adopted_at, appeal_deadline_date, notes
     ) values ($1,$2,$3,'adopted',$4,$5,$6,$7)
     returning id`,
    [structureId, jurisdictionId, calculationId, officialUserId, opts.adoptedAt, opts.appealDeadlineDate, opts.notes ?? null],
  );
  log(`Adopted determination for structure ${structureId}: ${inserted.rows[0].id}`);
  return inserted.rows[0].id;
}

async function insertDraftDetermination(client, jurisdictionId, structureId, calculationId, notes, log) {
  const existing = await client.query("select id, status from determinations where calculation_id = $1", [
    calculationId,
  ]);
  if (existing.rows.length > 0) {
    log(`Determination for calculation ${calculationId} already exists (${existing.rows[0].status}).`);
    return existing.rows[0].id;
  }
  const inserted = await client.query(
    `insert into determinations (structure_id, jurisdiction_id, calculation_id, status, notes)
     values ($1,$2,$3,'draft',$4)
     returning id`,
    [structureId, jurisdictionId, calculationId, notes],
  );
  log(`Created draft determination for structure ${structureId}: ${inserted.rows[0].id}`);
  return inserted.rows[0].id;
}

async function supersedeDetermination(client, determinationId, log) {
  const current = await client.query("select status from determinations where id = $1", [determinationId]);
  if (current.rows[0]?.status === "superseded") {
    log(`Determination ${determinationId} already superseded.`);
    return;
  }
  await client.query("update determinations set status = 'superseded' where id = $1", [determinationId]);
  log(`Superseded determination ${determinationId}.`);
}

function computeAppealDeadline(adoptedAtIso, appealWindowDays) {
  const adopted = new Date(adoptedAtIso);
  const deadline = new Date(Date.UTC(adopted.getUTCFullYear(), adopted.getUTCMonth(), adopted.getUTCDate()));
  deadline.setUTCDate(deadline.getUTCDate() + appealWindowDays);
  return deadline.toISOString().slice(0, 10);
}

async function issueLetterIfMissing(client, jurisdictionId, determinationId, facts, storagePut, log) {
  const existing = await client.query("select id, letter_id from determinations where id = $1", [determinationId]);
  if (existing.rows[0]?.letter_id) {
    log(`Letter already issued for determination ${determinationId}.`);
    return;
  }
  const letterId = randomUUID();
  const storageKey = `letters/${jurisdictionId}/${letterId}.html`;
  const html = renderDemoLetterHtml(facts);
  await storagePut(storageKey, Buffer.from(html, "utf8"));

  await client.query(
    `insert into letters (id, determination_id, jurisdiction_id, template_version, pdf_storage_key, issued_at, delivery_method)
     values ($1,$2,$3,'training-demo-letter-v1',$4,now(),'hand')`,
    [letterId, determinationId, jurisdictionId, storageKey],
  );
  await client.query("update determinations set letter_id = $1 where id = $2", [letterId, determinationId]);
  log(`Issued training letter for determination ${determinationId}: ${storageKey}`);
}

// ---------------------------------------------------------------------------
// Main scenario
// ---------------------------------------------------------------------------

function daysAgoIso(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

export async function seedDemoScenario(connectionString, { log = console.log, storagePut } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();

  const put = storagePut ?? (async (key, bytes) => putLocal(key, bytes));

  try {
    const jurisdictionId = await upsertJurisdiction(client, log);
    await upsertCostTable(client, jurisdictionId, log);
    const users = await upsertUsers(client, jurisdictionId, log);

    const structureIds = {};
    for (const def of STRUCTURES) {
      structureIds[def.num] = await upsertStructure(client, jurisdictionId, def, log);
    }

    // --- 002: mid-capture draft ------------------------------------------
    {
      const assessmentId = await upsertAssessment(
        client,
        jurisdictionId,
        structureIds["002"],
        users.assessor,
        "riverline-training-demo-102",
        {
          startedAt: daysAgoIso(0),
          completedAt: null,
          waterDepthIn: 18,
          waterDepthSource: "observed_line",
          notes: "[TRAINING DEMO] Mid-capture draft, intentionally incomplete. Not a real inspection.",
        },
        log,
      );
      await setAssessmentElements(
        client,
        assessmentId,
        jurisdictionId,
        { foundations: 50, superstructure: 25, exterior_finish: 25 },
        COST_TABLE_VERSION,
      );
    }

    // --- 003: completed, awaiting review (NOT_SD) -------------------------
    {
      const assessmentId = await upsertAssessment(
        client,
        jurisdictionId,
        structureIds["003"],
        users.assessor,
        "riverline-training-demo-103",
        {
          startedAt: daysAgoIso(2),
          completedAt: daysAgoIso(2),
          waterDepthIn: 9,
          waterDepthSource: "measured",
          notes: "[TRAINING DEMO] Completed assessment awaiting official review. Not a real inspection.",
        },
        log,
      );
      const damage = {
        foundations: 10,
        superstructure: 10,
        roof_covering: 0,
        exterior_finish: 10,
        interior_finish: 40,
        doors_windows: 20,
        cabinets_countertops: 10,
        floor_finish: 50,
        plumbing: 30,
        electrical: 20,
        appliances: 20,
        hvac: 10,
      };
      await setAssessmentElements(client, assessmentId, jurisdictionId, damage, COST_TABLE_VERSION);
      const calc = deriveCalculation(RESIDENTIAL_COSTS, 1500, damage, 0.28);
      await insertCalculationIfMissing(client, jurisdictionId, assessmentId, calc, 1, log);
    }

    // --- 004: completed, awaiting review (BORDERLINE) ----------------------
    {
      const assessmentId = await upsertAssessment(
        client,
        jurisdictionId,
        structureIds["004"],
        users.assessor,
        "riverline-training-demo-104",
        {
          startedAt: daysAgoIso(3),
          completedAt: daysAgoIso(3),
          waterDepthIn: 30,
          waterDepthSource: "observed_line",
          notes:
            "[TRAINING DEMO] Completed assessment landing in the BORDERLINE band, awaiting official review. Not a real inspection.",
        },
        log,
      );
      const damage = {
        foundations: 40,
        superstructure: 50,
        roof_covering: 30,
        exterior_finish: 50,
        interior_finish: 90,
        doors_windows: 60,
        cabinets_countertops: 50,
        floor_finish: 90,
        plumbing: 70,
        electrical: 60,
        appliances: 50,
        hvac: 40,
      };
      await setAssessmentElements(client, assessmentId, jurisdictionId, damage, COST_TABLE_VERSION);
      const calc = deriveCalculation(RESIDENTIAL_COSTS, 1500, damage, 0.5);
      await insertCalculationIfMissing(client, jurisdictionId, assessmentId, calc, 1, log);
    }

    // --- 005: adopted SD with issued letter --------------------------------
    {
      const assessmentId = await upsertAssessment(
        client,
        jurisdictionId,
        structureIds["005"],
        users.assessor,
        "riverline-training-demo-105",
        {
          startedAt: daysAgoIso(6),
          completedAt: daysAgoIso(6),
          waterDepthIn: 48,
          waterDepthSource: "observed_line",
          notes: "[TRAINING DEMO] Completed assessment, adopted SD with an issued letter. Not a real inspection.",
        },
        log,
      );
      const damage = {
        foundations: 80,
        superstructure: 90,
        roof_covering: 60,
        exterior_finish: 90,
        interior_finish: 100,
        doors_windows: 90,
        cabinets_countertops: 90,
        floor_finish: 100,
        plumbing: 100,
        electrical: 90,
        appliances: 90,
        hvac: 80,
      };
      await setAssessmentElements(client, assessmentId, jurisdictionId, damage, COST_TABLE_VERSION);
      const calc = deriveCalculation(RESIDENTIAL_COSTS, 1500, damage, 0.65);
      const calculationId = await insertCalculationIfMissing(client, jurisdictionId, assessmentId, calc, 1, log);
      const adoptedAt = daysAgoIso(5);
      const appealDeadline = computeAppealDeadline(adoptedAt, LETTERHEAD_CONFIG.appeal_window_days);
      const determinationId = await insertAdoptedDetermination(
        client,
        jurisdictionId,
        structureIds["005"],
        calculationId,
        users.official,
        {
          adoptedAt,
          appealDeadlineDate: appealDeadline,
          notes: "[TRAINING DEMO] Adopted for training purposes only.",
        },
        log,
      );
      await issueLetterIfMissing(
        client,
        jurisdictionId,
        determinationId,
        {
          jurisdictionName: LETTERHEAD_CONFIG.letterhead_name,
          structureAddress: "105 Training Flood Ct",
          parcelId: "TRAINING-DEMO-005",
          ratioPct: (calc.ratio * 100).toFixed(1),
          thresholdResult: calc.thresholdResult,
          ordinanceCitation: ORDINANCE_CITATION_TEXT,
          officialEmail: `demo-official@${EMAIL_DOMAIN}`,
          adoptedDateIso: adoptedAt.slice(0, 10),
        },
        put,
        log,
      );
    }

    // --- 006: adopted NOT_SD with issued letter ----------------------------
    {
      const assessmentId = await upsertAssessment(
        client,
        jurisdictionId,
        structureIds["006"],
        users.assessor,
        "riverline-training-demo-106",
        {
          startedAt: daysAgoIso(4),
          completedAt: daysAgoIso(4),
          waterDepthIn: 4,
          waterDepthSource: "owner_reported",
          notes: "[TRAINING DEMO] Completed assessment, adopted NOT_SD with an issued letter. Not a real inspection.",
        },
        log,
      );
      const damage = {
        foundations: 0,
        superstructure: 5,
        roof_covering: 10,
        exterior_finish: 5,
        interior_finish: 20,
        doors_windows: 10,
        cabinets_countertops: 5,
        floor_finish: 15,
        plumbing: 10,
        electrical: 10,
        appliances: 5,
        hvac: 5,
      };
      await setAssessmentElements(client, assessmentId, jurisdictionId, damage, COST_TABLE_VERSION);
      const calc = deriveCalculation(RESIDENTIAL_COSTS, 1500, damage, 0.15);
      const calculationId = await insertCalculationIfMissing(client, jurisdictionId, assessmentId, calc, 1, log);
      const adoptedAt = daysAgoIso(3);
      const appealDeadline = computeAppealDeadline(adoptedAt, LETTERHEAD_CONFIG.appeal_window_days);
      const determinationId = await insertAdoptedDetermination(
        client,
        jurisdictionId,
        structureIds["006"],
        calculationId,
        users.official,
        {
          adoptedAt,
          appealDeadlineDate: appealDeadline,
          notes: "[TRAINING DEMO] Adopted for training purposes only.",
        },
        log,
      );
      await issueLetterIfMissing(
        client,
        jurisdictionId,
        determinationId,
        {
          jurisdictionName: LETTERHEAD_CONFIG.letterhead_name,
          structureAddress: "106 Training Flood Ct",
          parcelId: "TRAINING-DEMO-006",
          ratioPct: (calc.ratio * 100).toFixed(1),
          thresholdResult: calc.thresholdResult,
          ordinanceCitation: ORDINANCE_CITATION_TEXT,
          officialEmail: `demo-official@${EMAIL_DOMAIN}`,
          adoptedDateIso: adoptedAt.slice(0, 10),
        },
        put,
        log,
      );
    }

    // --- 007: adopted SD, then superseded after a correction ---------------
    {
      const assessmentId = await upsertAssessment(
        client,
        jurisdictionId,
        structureIds["007"],
        users.assessor,
        "riverline-training-demo-107",
        {
          startedAt: daysAgoIso(10),
          completedAt: daysAgoIso(10),
          waterDepthIn: 40,
          waterDepthSource: "observed_line",
          notes:
            "[TRAINING DEMO] Non-residential example, later superseded after a re-inspection correction. Not a real inspection.",
        },
        log,
      );
      const heavyDamage = {
        foundations: 60,
        superstructure: 70,
        roof_covering: 50,
        plumbing: 70,
        electrical: 60,
        interiors: 80,
        hvac: 50,
      };
      // First pass: heavy damage, computed and adopted (this is what the
      // ORIGINAL calculations row must reflect — calculations are
      // immutable snapshots, so it stays "heavy" forever even though
      // assessment_elements below gets corrected afterward).
      const firstCalc = deriveCalculation(NON_RESIDENTIAL_COSTS, 3000, heavyDamage, 0.6);
      // Only set assessment_elements to the heavy values if this is truly
      // the first run (no calculation yet) — otherwise a re-run would
      // overwrite the corrected values below back to "heavy" before the
      // idempotency check for the second calculation even runs.
      const calcCountRes = await client.query("select count(*)::int as n from calculations where assessment_id = $1", [
        assessmentId,
      ]);
      if (calcCountRes.rows[0].n === 0) {
        await setAssessmentElements(client, assessmentId, jurisdictionId, heavyDamage, COST_TABLE_VERSION);
      }
      const firstCalculationId = await insertCalculationIfMissing(
        client,
        jurisdictionId,
        assessmentId,
        firstCalc,
        1,
        log,
      );
      const firstAdoptedAt = daysAgoIso(9);
      const firstAppealDeadline = computeAppealDeadline(firstAdoptedAt, LETTERHEAD_CONFIG.appeal_window_days);
      const firstDeterminationId = await insertAdoptedDetermination(
        client,
        jurisdictionId,
        structureIds["007"],
        firstCalculationId,
        users.official,
        {
          adoptedAt: firstAdoptedAt,
          appealDeadlineDate: firstAppealDeadline,
          notes: "[TRAINING DEMO] Original adoption, later superseded — see the newer draft determination.",
        },
        log,
      );

      // Second pass: re-inspection correction lowers the damage estimate.
      // Mirrors app/determination/_lib/actions.ts's overrideElementDamage
      // (mutate assessment_elements in place) + computeAndPersistCalculation
      // (insert a NEW immutable calculations row) + supersedeDetermination
      // (flip the old determination to 'superseded', insert a new 'draft').
      const lightDamage = {
        foundations: 20,
        superstructure: 25,
        roof_covering: 15,
        plumbing: 20,
        electrical: 15,
        interiors: 30,
        hvac: 15,
      };
      await setAssessmentElements(client, assessmentId, jurisdictionId, lightDamage, COST_TABLE_VERSION);
      // The structure's appraised value doesn't change just because a
      // re-inspection revised the damage estimate downward, so the second
      // calculation reuses the FIRST calculation's market_value_used
      // (unlike the other scenarios above, which each derive a fresh
      // market value from a target ratio) — only total_repair_cost/ratio/
      // threshold are recomputed, from the corrected (light) damage map.
      const secondTotal = computeTotal(NON_RESIDENTIAL_COSTS, 3000, lightDamage);
      const secondBasisPoints = ratioBasisPoints(secondTotal, firstCalc.marketValueUsed);
      const secondCalc = {
        totalRepairCost: secondTotal,
        marketValueUsed: firstCalc.marketValueUsed,
        ratio: Number(secondBasisPoints) / 10000,
        thresholdResult: classify(secondBasisPoints),
      };
      const secondCalculationId = await insertCalculationIfMissing(
        client,
        jurisdictionId,
        assessmentId,
        secondCalc,
        2,
        log,
      );
      await insertDraftDetermination(
        client,
        jurisdictionId,
        structureIds["007"],
        secondCalculationId,
        `[TRAINING DEMO] Supersedes determination ${firstDeterminationId}. Reason: re-inspection found the water line ` +
          "was mismeasured on the first pass; damage percentages corrected downward. This note demonstrates the audited " +
          "override trail, same as a real supersede action.",
        log,
      );
      await supersedeDetermination(client, firstDeterminationId, log);
    }

    log(`Demo scenario seed complete for jurisdiction ${jurisdictionId}.`);
    return { jurisdictionId, users, structureIds };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function loadEnvFile(filePath) {
  const text = await readFile(filePath, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const isTest = process.argv.includes("--test");
  const isLive = process.argv.includes("--live");

  if (isTest && isLive) {
    console.error("Pass only one of --test / --live.");
    process.exit(1);
  }

  if (isLive) {
    const envPath = path.resolve(__dirname, "../../.env.supabase");
    let env;
    try {
      env = await loadEnvFile(envPath);
    } catch {
      console.error(`BLOCKER: could not read ${envPath}. See docs/deploy/vercel-notes.md.`);
      process.exit(1);
    }
    if (!env.DATABASE_URL_SESSION) {
      console.error(`BLOCKER: DATABASE_URL_SESSION not set in ${envPath}.`);
      process.exit(1);
    }
    const connStr = `${env.DATABASE_URL_SESSION}?sslmode=no-verify`;
    await applyMigrations(connStr);
    const storagePut =
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.STORAGE_BUCKET
        ? (key, bytes) =>
            putSupabase(key, bytes, {
              url: env.SUPABASE_URL,
              serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
              bucket: env.STORAGE_BUCKET,
            })
        : undefined;
    await seedDemoScenario(connStr, { storagePut });
    console.log("Live seed complete (Supabase, DATABASE_URL_SESSION).");
  } else {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) {
      console.error("BLOCKER: DATABASE_URL is not set. See .env.example.");
      process.exit(1);
    }
    const targetUrl = isTest ? withDatabaseName(baseUrl, "riverline_test") : baseUrl;
    if (isTest) await ensureDatabaseExists(targetUrl);
    await applyMigrations(targetUrl);

    const storagePut =
      process.env.STORAGE_DRIVER === "supabase" &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.STORAGE_BUCKET
        ? (key, bytes) =>
            putSupabase(key, bytes, {
              url: process.env.NEXT_PUBLIC_SUPABASE_URL,
              serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
              bucket: process.env.STORAGE_BUCKET,
            })
        : undefined;

    await seedDemoScenario(targetUrl, { storagePut });
    console.log(`Seed complete for ${isTest ? "riverline_test" : "DATABASE_URL"}.`);
  }
}
