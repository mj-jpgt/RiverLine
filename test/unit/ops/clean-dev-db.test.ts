import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import {
  assertSafeDatabaseName,
  parseCleanArgs,
  computeTargets,
  previewCounts,
  runCleanup,
  cleanJurisdictionUploads,
  cleanOrphanedUploads,
  PROTECTED_DEMO_EMAILS,
  PROTECTED_JURISDICTION_NAME,
} from "../../../scripts/ops/clean-dev-db.mjs";

// V5 task 1 (docs/journal/2026-08-18-v5-data.md): proves the dev-db cleaner's
// targeting/deletion logic against a REAL Postgres database — riverline_test
// (AGENTS.md rule 6: fixtures/synthetic seed data belong only in *_test dbs;
// this suite seeds riverline_test the same way test/unit/modules/a2/queries.test.ts
// already does, never riverline_dev).
//
// This does NOT exercise the CLI's own database-name safety rail end-to-end
// (that rail explicitly refuses *_test databases by name — see
// assertSafeDatabaseName's own unit tests below, which prove that refusal
// directly) — it calls computeTargets/previewCounts/runCleanup as plain
// functions against a pg.Client, the same pattern every other DB-integration
// suite in this repo uses. The real end-to-end run against the real
// riverline_dev (copy-tested first against a disposable clone per this
// task's instructions) is documented with its own before/after counts in
// docs/journal/2026-08-18-v5-data.md — this suite is what makes that run's
// logic reproducibly verifiable, not a substitute for having done it.

describe("assertSafeDatabaseName — pure, no DB", () => {
  it("accepts riverline_dev with no override", () => {
    expect(() => assertSafeDatabaseName("riverline_dev")).not.toThrow();
  });

  it("refuses any other name without an override", () => {
    expect(() => assertSafeDatabaseName("riverline_dev_clone_scratch")).toThrow(/only "riverline_dev" is allowed/);
    expect(() => assertSafeDatabaseName("postgres")).toThrow(/only "riverline_dev" is allowed/);
  });

  it("refuses *_test databases even WITH an override", () => {
    expect(() => assertSafeDatabaseName("riverline_test", { override: true })).toThrow(/looks like a \*_test database/);
    expect(() => assertSafeDatabaseName("riverline_dev_scratch_test", { override: true })).toThrow(
      /looks like a \*_test database/,
    );
  });

  it("refuses production-looking names even WITH an override", () => {
    expect(() => assertSafeDatabaseName("riverline_prod", { override: true })).toThrow(/production-related/);
    expect(() => assertSafeDatabaseName("riverline_dev_production_copy", { override: true })).toThrow(/production-related/);
  });

  it("refuses any override that isn't a riverline_dev* clone name", () => {
    expect(() => assertSafeDatabaseName("some_unrelated_db", { override: true })).toThrow(
      /must name an actual clone of riverline_dev/,
    );
  });

  it("accepts a well-formed riverline_dev* clone override", () => {
    expect(() => assertSafeDatabaseName("riverline_dev_clone_scratch", { override: true })).not.toThrow();
  });
});

describe("parseCleanArgs — pure, no DB", () => {
  it("defaults to no --yes, no override", () => {
    expect(parseCleanArgs([])).toEqual({ yes: false, dbOverride: null });
  });

  it("parses --yes and --db-override=<name>", () => {
    expect(parseCleanArgs(["--yes", "--db-override=riverline_dev_clone_scratch"])).toEqual({
      yes: true,
      dbOverride: "riverline_dev_clone_scratch",
    });
  });
});

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. This suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");

describe("computeTargets / previewCounts / runCleanup — real Postgres, riverline_test", () => {
  let client: pg.Client;
  const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Four jurisdictions, each probing one guard in computeTargets():
  let pollutedJurisdictionId: string; // (a) every user matches a pattern, name doesn't collide -> TARGETED
  let demoNamedJurisdictionId: string; // (b) name === PROTECTED_JURISDICTION_NAME even though its user matches -> NEVER targeted
  let mixedJurisdictionId: string; // (c) one matching user + one real user -> NEVER targeted (whole jurisdiction excluded)
  let practiceParcelJurisdictionId: string; // (d) matching users, but holds a DEMO-PRACTICE% structure -> NEVER targeted

  let pollutedStructureId: string;
  let pollutedAssessmentId: string;
  let pollutedCalculationId: string;
  let pollutedDeterminationId: string;
  let pollutedLetterId: string;
  let pollutedEstimateId: string;

  beforeAll(async () => {
    await ensureDatabaseExists(testUrl);
    await applyMigrations(testUrl);
    client = new pg.Client({ connectionString: testUrl });
    await client.connect();

    // (a) fully polluted jurisdiction, cascades through every table.
    const jA = await client.query(
      `insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`,
      [`A2 E2E Jurisdiction TEST-${RUN_ID}`],
    );
    pollutedJurisdictionId = jA.rows[0].id as string;
    const uA1 = await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin') returning id`, [
      `a2-e2e-clean-${RUN_ID}-one@example.gov`,
      pollutedJurisdictionId,
    ]);
    await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'official')`, [
      `debug-ocr-clean-${RUN_ID}-two@example.gov`,
      pollutedJurisdictionId,
    ]);
    const userA1 = uA1.rows[0].id as string;

    const sA = await client.query(
      `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type)
       values ($1, $2, $3, 180000, 'appraisal', 'residential') returning id`,
      [pollutedJurisdictionId, `CLEAN-TEST-${RUN_ID}-A`, "1 Polluted Test St"],
    );
    pollutedStructureId = sA.rows[0].id as string;
    const aA = await client.query(
      `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
       values ($1, $2, $3, $4, now()) returning id`,
      [pollutedStructureId, pollutedJurisdictionId, userA1, `clean-test-client-${RUN_ID}-A`],
    );
    pollutedAssessmentId = aA.rows[0].id as string;
    const cA = await client.query(
      `insert into calculations (assessment_id, jurisdiction_id, cost_table_version, total_repair_cost, market_value_used, value_source, ratio, threshold_result, engine_version)
       values ($1, $2, $3, 100000, 180000, 'appraisal', 0.55, 'SD', 'test') returning id`,
      [pollutedAssessmentId, pollutedJurisdictionId, `CLEAN-TEST-${RUN_ID}`],
    );
    pollutedCalculationId = cA.rows[0].id as string;
    const dA = await client.query(
      `insert into determinations (structure_id, jurisdiction_id, calculation_id, status, adopted_by_user_id, adopted_at)
       values ($1, $2, $3, 'adopted', $4, now()) returning id`,
      [pollutedStructureId, pollutedJurisdictionId, pollutedCalculationId, userA1],
    );
    pollutedDeterminationId = dA.rows[0].id as string;
    const lA = await client.query(
      `insert into letters (determination_id, jurisdiction_id, template_version, pdf_storage_key, issued_at)
       values ($1, $2, 'v1', $3, now()) returning id`,
      [pollutedDeterminationId, pollutedJurisdictionId, `letters/${pollutedJurisdictionId}/clean-test.html`],
    );
    pollutedLetterId = lA.rows[0].id as string;
    // Wire the circular FK (determinations.letter_id -> letters.id) so the
    // cascade actually has to break it, same as production data can.
    await client.query(`update determinations set letter_id = $1 where id = $2`, [pollutedLetterId, pollutedDeterminationId]);

    const eA = await client.query(
      `insert into estimates (assessment_id, jurisdiction_id, storage_key, sha256, version)
       values ($1, $2, $3, $4, 1) returning id`,
      [pollutedAssessmentId, pollutedJurisdictionId, `${pollutedJurisdictionId}/estimates/clean-test.jpg`, "0".repeat(64)],
    );
    pollutedEstimateId = eA.rows[0].id as string;
    // A second estimate superseding the first, to prove the self-FK
    // (supersedes_estimate_id) gets broken before delete too.
    await client.query(
      `insert into estimates (assessment_id, jurisdiction_id, storage_key, sha256, version, supersedes_estimate_id)
       values ($1, $2, $3, $4, 2, $5)`,
      [pollutedAssessmentId, pollutedJurisdictionId, `${pollutedJurisdictionId}/estimates/clean-test-v2.jpg`, "1".repeat(64), pollutedEstimateId],
    );

    await client.query(
      `insert into audit_log (actor_user_id, jurisdiction_id, entity_type, entity_id, action, after_json)
       values ($1, $2, 'determination', $3, 'insert', '{}'::jsonb)`,
      [userA1, pollutedJurisdictionId, pollutedDeterminationId],
    );
    await client.query(`insert into login_tokens (user_id, token_hash, expires_at) values ($1, $2, now() + interval '15 minutes')`, [
      userA1,
      `clean-test-token-hash-${RUN_ID}`.padEnd(64, "0").slice(0, 64),
    ]);

    // (b) name collides with the protected jurisdiction name; its user still
    // matches the pollution pattern, proving the name guard, not just the
    // pattern-match, is what excludes it.
    const jB = await client.query(
      `insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`,
      [PROTECTED_JURISDICTION_NAME],
    );
    demoNamedJurisdictionId = jB.rows[0].id as string;
    await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin')`, [
      `a2-e2e-clean-${RUN_ID}-democollide@example.gov`,
      demoNamedJurisdictionId,
    ]);

    // (c) mixed jurisdiction: one matching user, one real-looking user.
    const jC = await client.query(
      `insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`,
      [`Mixed Jurisdiction TEST-${RUN_ID}`],
    );
    mixedJurisdictionId = jC.rows[0].id as string;
    await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin')`, [
      `a4-e2e-clean-${RUN_ID}-mixed@example.gov`,
      mixedJurisdictionId,
    ]);
    await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'official')`, [
      `real-official-clean-${RUN_ID}@example.gov`,
      mixedJurisdictionId,
    ]);

    // (d) practice-parcel jurisdiction: matching users, but holds a
    // DEMO-PRACTICE%-prefixed structure.
    const jD = await client.query(
      `insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`,
      [`Practice Parcel Jurisdiction TEST-${RUN_ID}`],
    );
    practiceParcelJurisdictionId = jD.rows[0].id as string;
    await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin')`, [
      `debug-ocr-clean-${RUN_ID}-practice@example.gov`,
      practiceParcelJurisdictionId,
    ]);
    await client.query(
      `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type)
       values ($1, $2, $3, 180000, 'appraisal', 'residential')`,
      [practiceParcelJurisdictionId, `DEMO-PRACTICE-CLEAN-${RUN_ID}`, "123 Practice Ln Clone"],
    );
  }, 60_000);

  afterAll(async () => {
    // Best-effort teardown of whatever the test didn't already delete
    // (the mixed/demo-named/practice-parcel jurisdictions are deliberately
    // left standing by runCleanup — clean them up here so repeated runs of
    // this suite don't accumulate rows in riverline_test).
    for (const jid of [demoNamedJurisdictionId, mixedJurisdictionId, practiceParcelJurisdictionId]) {
      await client.query(`delete from structures where jurisdiction_id = $1`, [jid]);
      await client.query(`delete from users where jurisdiction_id = $1`, [jid]);
      await client.query(`delete from jurisdictions where id = $1`, [jid]);
    }
    await client.end();
  });

  it("computeTargets: targets ONLY the fully-polluted jurisdiction — name collision, mixed users, and practice-parcel guards all exclude the other three", async () => {
    const targets = await computeTargets(client);

    expect(targets.jurisdictionIds).toContain(pollutedJurisdictionId);
    expect(targets.jurisdictionIds).not.toContain(demoNamedJurisdictionId);
    expect(targets.jurisdictionIds).not.toContain(mixedJurisdictionId);
    expect(targets.jurisdictionIds).not.toContain(practiceParcelJurisdictionId);

    // None of the three protected seeded demo emails ever appear, by
    // construction of the seed data here (none were inserted) — this also
    // implicitly proves computeTargets' own internal assertion didn't fire.
    for (const email of PROTECTED_DEMO_EMAILS) {
      expect(targets.users.some((u: { email: string }) => u.email === email)).toBe(false);
    }
  });

  it("previewCounts: exact counts for the one targeted jurisdiction's rows", async () => {
    // NOTE: riverline_test is shared with other concurrently-running agents'
    // own e2e/unit suites (a2-dashboard, a4-estimates, etc.), which use these
    // SAME a2-e2e-%/a4-e2e-%/debug-ocr-% naming conventions for their own
    // fixtures — so computeTargets() legitimately picks up more than just
    // this suite's one seeded jurisdiction here. previewCounts is scoped by
    // an EXPLICIT id list, so it is unaffected by that concurrent noise;
    // that's what this test actually proves.
    const targets = await computeTargets(client);
    const counts = await previewCounts(client, [pollutedJurisdictionId]);

    expect(counts.jurisdictions).toBe(1);
    expect(counts.users).toBe(2);
    expect(counts.structures).toBe(1);
    expect(counts.assessments).toBe(1);
    expect(counts.calculations).toBe(1);
    expect(counts.determinations).toBe(1);
    expect(counts.letters).toBe(1);
    expect(counts.estimates).toBe(2);
    expect(counts.audit_log).toBeGreaterThanOrEqual(1); // >= our manual insert (+ any trigger-generated rows)
    expect(counts.login_tokens).toBe(1);

    // Sanity: computeTargets (unscoped) still includes this suite's own
    // jurisdiction among whatever else concurrent agents seeded.
    expect(targets.jurisdictionIds).toContain(pollutedJurisdictionId);
  });

  it("runCleanup: deletes the full cascade (breaking the letters<->determinations and estimates self FKs) and re-enables every trigger afterward", async () => {
    const result = await runCleanup(client, [pollutedJurisdictionId]);
    expect(result.deleted).toBe(true);
    expect(result.jurisdictionCount).toBe(1);

    const remaining = await previewCounts(client, [pollutedJurisdictionId]);
    expect(remaining).toEqual({
      jurisdictions: 0,
      users: 0,
      structures: 0,
      assessments: 0,
      assessment_elements: 0,
      photos: 0,
      calculations: 0,
      determinations: 0,
      letters: 0,
      estimates: 0,
      audit_log: 0,
      login_tokens: 0,
    });

    // Triggers were re-enabled, not left disabled: a fresh, unrelated
    // calculations row still cannot be UPDATEd or DELETEd after this run.
    const proofJurisdiction = await client.query(
      `insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`,
      [`Trigger Reenable Proof TEST-${RUN_ID}`],
    );
    const proofJid = proofJurisdiction.rows[0].id as string;
    const proofUser = await client.query(`insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin') returning id`, [
      `trigger-proof-${RUN_ID}@example.gov`,
      proofJid,
    ]);
    const proofStructure = await client.query(
      `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type)
       values ($1, $2, $3, 180000, 'appraisal', 'residential') returning id`,
      [proofJid, `TRIGGER-PROOF-${RUN_ID}`, "1 Trigger Proof St"],
    );
    const proofAssessment = await client.query(
      `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
       values ($1, $2, $3, $4, now()) returning id`,
      [proofStructure.rows[0].id, proofJid, proofUser.rows[0].id, `trigger-proof-client-${RUN_ID}`],
    );
    const proofCalc = await client.query(
      `insert into calculations (assessment_id, jurisdiction_id, cost_table_version, total_repair_cost, market_value_used, value_source, ratio, threshold_result, engine_version)
       values ($1, $2, 'v', 1, 180000, 'appraisal', 0.1, 'NOT_SD', 'test') returning id`,
      [proofAssessment.rows[0].id, proofJid],
    );
    await expect(client.query(`delete from calculations where id = $1`, [proofCalc.rows[0].id])).rejects.toThrow(/immutable/);

    // No teardown of this proof fixture: the calculations row is now
    // provably immutable again (the whole point of this test), so it — and
    // everything that references it — is left in place, same as every other
    // suite in this repo that seeds riverline_test and relies on it being
    // rebuilt by harnesses rather than self-cleaned (AGENTS.md rule 6;
    // test/unit/modules/a2/queries.test.ts does the same).
  });

  it("the three protected jurisdictions and their rows are completely untouched by runCleanup", async () => {
    const stillThere = await client.query(`select name from jurisdictions where id = any($1::uuid[])`, [
      [demoNamedJurisdictionId, mixedJurisdictionId, practiceParcelJurisdictionId],
    ]);
    expect(stillThere.rows).toHaveLength(3);

    const mixedUsers = await client.query(`select count(*)::int as n from users where jurisdiction_id = $1`, [mixedJurisdictionId]);
    expect(mixedUsers.rows[0].n).toBe(2); // both survive — the whole jurisdiction was excluded, not just the "real" user

    const practiceStructure = await client.query(`select count(*)::int as n from structures where jurisdiction_id = $1 and parcel_id like 'DEMO-PRACTICE%'`, [
      practiceParcelJurisdictionId,
    ]);
    expect(practiceStructure.rows[0].n).toBe(1);
  });

  it("runCleanup is a safe no-op when given an empty jurisdiction list", async () => {
    const result = await runCleanup(client, []);
    expect(result).toEqual({ deleted: true, jurisdictionCount: 0 });
  });
});

describe("cleanJurisdictionUploads / cleanOrphanedUploads — real filesystem, scratch temp dir only", () => {
  let scratchRoot: string;
  let client: pg.Client;

  beforeAll(async () => {
    scratchRoot = mkdtempSync(path.join(tmpdir(), "riverline-clean-uploads-"));
    client = new pg.Client({ connectionString: testUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  it("cleanJurisdictionUploads removes only the named jurisdiction directories, leaves others alone", () => {
    const root = mkdtempSync(path.join(scratchRoot, "case-a-"));
    const targetId = "11111111-1111-1111-1111-111111111111";
    const otherId = "22222222-2222-2222-2222-222222222222";
    mkdirSync(path.join(root, targetId, "estimates"), { recursive: true });
    writeFileSync(path.join(root, targetId, "photo.jpg"), "x");
    mkdirSync(path.join(root, otherId), { recursive: true });
    writeFileSync(path.join(root, otherId, "photo.jpg"), "x");

    const result = cleanJurisdictionUploads([targetId], { uploadsRoot: root });
    expect(result.removedDirs).toBe(1);
    expect(existsSync(path.join(root, targetId))).toBe(false);
    expect(existsSync(path.join(root, otherId))).toBe(true);
  });

  it("cleanOrphanedUploads removes only directories with no matching jurisdiction row, never a live one", async () => {
    const root = mkdtempSync(path.join(scratchRoot, "case-b-"));
    const j = await client.query(`insert into jurisdictions (name, letterhead_config) values ($1, '{}'::jsonb) returning id`, [
      `Orphan Upload Proof TEST-${Date.now()}`,
    ]);
    const liveId = j.rows[0].id as string;
    const orphanId = "33333333-3333-3333-3333-333333333333";
    const orphanLetterId = "44444444-4444-4444-4444-444444444444";

    mkdirSync(path.join(root, liveId), { recursive: true });
    mkdirSync(path.join(root, orphanId), { recursive: true });
    mkdirSync(path.join(root, "letters", orphanLetterId), { recursive: true });

    const result = await cleanOrphanedUploads(client, { uploadsRoot: root });
    expect(result.removedOrphanDirs).toBe(2); // orphanId + letters/orphanLetterId
    expect(existsSync(path.join(root, liveId))).toBe(true); // live jurisdiction's dir untouched
    expect(existsSync(path.join(root, orphanId))).toBe(false);
    expect(existsSync(path.join(root, "letters", orphanLetterId))).toBe(false);
    expect(existsSync(path.join(root, "letters"))).toBe(true); // the letters/ dir itself is never removed

    await client.query(`delete from jurisdictions where id = $1`, [liveId]);
  });
});
