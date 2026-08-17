import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../scripts/db/migrate.mjs";
import { getReviewQueue, getReviewDetail, listAuditLogForAssessment } from "../../../src/core/determination/queries";
import {
  overrideElementDamage,
  overrideMarketValue,
  adoptDetermination,
  supersedeDetermination,
} from "../../../app/determination/_lib/actions";
import { computeAndPersistCalculation } from "../../../app/calculation/_lib/compute";
import costTableFixture from "../../fixtures/engine/cost-table.test-fixture-v0.json";

// Real Postgres, real writes, no mocks — proves T-C5's core legal
// invariant end to end: THE TOOL PROPOSES, THE OFFICIAL ADOPTS.
// AGENTS.md rule 6: this test only ever seeds riverline_test.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The determination persistence suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;

// Configured jurisdiction: appeal_window_days set — proves the happy path
// computes appeal_deadline_date correctly.
let configuredJurisdictionId: string;
let configuredUserId: string;
let configuredCostTableVersion: string;

// Unconfigured jurisdiction: letterhead_config = '{}' (the real, honest
// default per scripts/db/seed.mjs) — proves adoption still succeeds but
// appeal_deadline_date is left NULL, never an invented number of days.
let unconfiguredJurisdictionId: string;
let unconfiguredUserId: string;

// G3-shaped damage from the golden fixtures (same recipe test/unit/engine/persist.test.ts
// uses): total_repair_cost 39250 for a 1000 sq ft residential structure.
const DAMAGE: Record<string, number> = {
  foundations: 25,
  superstructure: 50,
  roof_covering: 100,
  interior_finish: 75,
  floor_finish: 50,
  plumbing: 25,
  electrical: 25,
};

async function seedCostTable(jurisdictionId: string): Promise<string> {
  const version = `${costTableFixture.version}-${jurisdictionId}`;
  await admin.query(
    `insert into cost_tables (version, jurisdiction_id, source_citation, effective_date, json_payload)
     values ($1, $2, $3, $4, $5)
     on conflict (version) do nothing`,
    [
      version,
      jurisdictionId,
      costTableFixture.source_citation,
      costTableFixture.effective_date,
      JSON.stringify({ base_cost_per_sqft: costTableFixture.base_cost_per_sqft }),
    ],
  );
  return version;
}

async function seedAssessment(
  jurisdictionId: string,
  userId: string,
  addressLabel: string,
  marketValue: number,
  damage: Record<string, number> | null,
): Promise<{ clientId: string; structureId: string; assessmentId: string }> {
  const parcelId = `DET-TEST-${addressLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const s = await admin.query(
    `insert into structures (
       jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft
     ) values ($1, $2, $3, $4, 'appraisal', 'residential', 1000) returning id`,
    [jurisdictionId, parcelId, addressLabel, marketValue],
  );
  const structureId = s.rows[0].id as string;

  const clientId = `det-test-${addressLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const a = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
     values ($1, $2, $3, $4, now()) returning id`,
    [structureId, jurisdictionId, userId, clientId],
  );
  const assessmentId = a.rows[0].id as string;

  if (damage) {
    for (const [code, pct] of Object.entries(damage)) {
      await admin.query(
        `insert into assessment_elements (assessment_id, jurisdiction_id, element_code, damage_pct, cost_table_version)
         values ($1, $2, $3, $4, 'NONE')`,
        [assessmentId, jurisdictionId, code, pct],
      );
    }
  }

  return { clientId, structureId, assessmentId };
}

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const cj = await admin.query(
    `insert into jurisdictions (name, letterhead_config) values ($1, $2) returning id`,
    ["Determination Test Jurisdiction (configured)", JSON.stringify({ appeal_window_days: 30 })],
  );
  configuredJurisdictionId = cj.rows[0].id;
  configuredCostTableVersion = await seedCostTable(configuredJurisdictionId);
  const cu = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
    [`det-test-configured-${Date.now()}@example.gov`, configuredJurisdictionId],
  );
  configuredUserId = cu.rows[0].id;

  const uj = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    "Determination Test Jurisdiction (unconfigured)",
  ]);
  unconfiguredJurisdictionId = uj.rows[0].id;
  await seedCostTable(unconfiguredJurisdictionId);
  const uu = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
    [`det-test-unconfigured-${Date.now()}@example.gov`, unconfiguredJurisdictionId],
  );
  unconfiguredUserId = uu.rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

describe("getReviewQueue — BORDERLINE first, then SD, then NOT_SD, then no-calculation", () => {
  it("real Postgres ordering matches the pure comparator", async () => {
    const notSd = await seedAssessment(configuredJurisdictionId, configuredUserId, "not-sd-house", 200000, DAMAGE);
    const borderline = await seedAssessment(configuredJurisdictionId, configuredUserId, "borderline-house", 80000, DAMAGE);
    const sd = await seedAssessment(configuredJurisdictionId, configuredUserId, "sd-house", 60000, DAMAGE);
    const noCalc = await seedAssessment(configuredJurisdictionId, configuredUserId, "no-calc-house", 100000, null);

    for (const target of [notSd, borderline, sd]) {
      const result = await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, target.clientId);
      expect(result.status).toBe("ok");
    }

    const queue = await getReviewQueue(configuredJurisdictionId, configuredUserId);
    const ids = queue.map((r) => r.assessmentId);

    expect(ids.indexOf(borderline.assessmentId)).toBeLessThan(ids.indexOf(sd.assessmentId));
    expect(ids.indexOf(sd.assessmentId)).toBeLessThan(ids.indexOf(notSd.assessmentId));
    expect(ids.indexOf(notSd.assessmentId)).toBeLessThan(ids.indexOf(noCalc.assessmentId));

    const borderlineRow = queue.find((r) => r.assessmentId === borderline.assessmentId);
    expect(borderlineRow?.thresholdResult).toBe("BORDERLINE");
    const noCalcRow = queue.find((r) => r.assessmentId === noCalc.assessmentId);
    expect(noCalcRow?.thresholdResult).toBeNull();
  });
});

describe("overrideElementDamage — audited, mandatory reason, inserts a new calculations row", () => {
  it("rejects an empty reason before writing anything", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "override-empty-reason", 200000, DAMAGE);
    await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);

    const before = await admin.query(`select count(*)::int as n from calculations c join assessments a on a.id = c.assessment_id where a.client_id = $1`, [seeded.clientId]);

    const result = await overrideElementDamage(configuredJurisdictionId, configuredUserId, seeded.clientId, "foundations", 100, "");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("reason_required");

    const after = await admin.query(`select count(*)::int as n from calculations c join assessments a on a.id = c.assessment_id where a.client_id = $1`, [seeded.clientId]);
    expect(after.rows[0].n).toBe(before.rows[0].n); // no new calc row
  });

  it("with a real reason: updates the element, writes an audit_log row with before/after + reason, and inserts a NEW calculations row (old row untouched)", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "override-real-reason", 200000, DAMAGE);
    const initial = await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") throw new Error("expected ok");
    const originalCalculationId = initial.calculation.id;

    const result = await overrideElementDamage(
      configuredJurisdictionId,
      configuredUserId,
      seeded.clientId,
      "foundations",
      100,
      "Field re-inspection found more extensive foundation damage.",
    );
    expect(result.ok).toBe(true);
    expect(result.compute?.status).toBe("ok");
    if (result.compute?.status !== "ok") throw new Error("expected ok");
    const newCalculationId = result.compute.calculation.id;
    expect(newCalculationId).not.toBe(originalCalculationId);

    // Old calculation row is untouched and still queryable — insert-only.
    const oldRow = await admin.query(`select total_repair_cost from calculations where id = $1`, [originalCalculationId]);
    expect(oldRow.rows.length).toBe(1);
    expect(Number(oldRow.rows[0].total_repair_cost)).toBe(39250);

    // Damage was actually applied.
    const elementRow = await admin.query(
      `select damage_pct from assessment_elements where assessment_id = $1 and element_code = 'foundations'`,
      [seeded.assessmentId],
    );
    expect(Number(elementRow.rows[0].damage_pct)).toBe(100);

    // Audit trail: entity_type='assessment_element', reason recorded in after_json.
    const audit = await admin.query(
      `select before_json, after_json, actor_user_id from audit_log
       where entity_type = 'assessment_element' and action = 'override_damage_pct'
       and (after_json->>'element_code') = 'foundations'
       and (before_json->>'damage_pct')::int = 25
       order by at desc limit 1`,
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].actor_user_id).toBe(configuredUserId);
    expect(audit.rows[0].after_json.reason).toContain("Field re-inspection");
    expect(audit.rows[0].after_json.damage_pct).toBe(100);

    // listAuditLogForAssessment surfaces the same entry (review-screen history).
    const history = await listAuditLogForAssessment(configuredJurisdictionId, configuredUserId, seeded.assessmentId);
    expect(history.some((h) => h.entityType === "assessment_element" && h.action === "override_damage_pct")).toBe(true);
  });
});

describe("overrideMarketValue — audited, mandatory reason, inserts a new calculations row", () => {
  it("rejects an invalid value source", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "override-value-bad-source", 200000, DAMAGE);
    await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    const result = await overrideMarketValue(
      configuredJurisdictionId,
      configuredUserId,
      seeded.clientId,
      150000,
      // @ts-expect-error — deliberately invalid, proving the guard rejects it
      "assessed_total",
      "reason",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_value_source");
  });

  it("sets value + value_source, audits before/after, and recomputes into a new row", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "override-value-real", 200000, DAMAGE);
    const initial = await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    expect(initial.status).toBe("ok");

    const result = await overrideMarketValue(
      configuredJurisdictionId,
      configuredUserId,
      seeded.clientId,
      70000,
      "appraisal",
      "Independent appraisal dated 2026-01-15 supersedes assessed value.",
    );
    expect(result.ok).toBe(true);
    expect(result.compute?.status).toBe("ok");
    if (result.compute?.status !== "ok") throw new Error("expected ok");
    expect(result.compute.calculation.marketValueUsed).toBe(70000);
    expect(result.compute.calculation.valueSource).toBe("appraisal");
    // 39250 / 70000 = 0.560714... -> SD now, was NOT_SD at 200000.
    expect(result.compute.calculation.thresholdResult).toBe("SD");

    const structureRow = await admin.query(`select assessor_market_value, value_source from structures where id = $1`, [
      seeded.structureId,
    ]);
    expect(Number(structureRow.rows[0].assessor_market_value)).toBe(70000);
    expect(structureRow.rows[0].value_source).toBe("appraisal");

    const audit = await admin.query(
      `select before_json, after_json from audit_log where entity_type = 'structure' and action = 'override_market_value' and entity_id = $1 order by at desc limit 1`,
      [seeded.structureId],
    );
    expect(audit.rows.length).toBe(1);
    expect(Number(audit.rows[0].before_json.assessor_market_value)).toBe(200000);
    expect(Number(audit.rows[0].after_json.assessor_market_value)).toBe(70000);
    expect(audit.rows[0].after_json.reason).toContain("Independent appraisal");
  });
});

describe("adoptDetermination — THE TOOL PROPOSES, THE OFFICIAL ADOPTS", () => {
  it("requires explicit confirmation", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "adopt-no-confirm", 200000, DAMAGE);
    await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    const result = await adoptDetermination(configuredJurisdictionId, configuredUserId, seeded.clientId, false);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("confirmation_required");

    const det = await admin.query(`select count(*)::int as n from determinations d join calculations c on c.id = d.calculation_id where c.assessment_id = $1`, [seeded.assessmentId]);
    expect(det.rows[0].n).toBe(0);
  });

  it("configured jurisdiction: adopts and computes a real appeal_deadline_date; audit_log gets the determination INSERT via the schema trigger", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "adopt-configured", 200000, DAMAGE);
    await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);

    const result = await adoptDetermination(configuredJurisdictionId, configuredUserId, seeded.clientId, true);
    expect(result.ok).toBe(true);
    expect(result.appealWindowConfigured).toBe(true);
    expect(result.appealDeadlineDate).not.toBeNull();

    const detRow = await admin.query(`select * from determinations where id = $1`, [result.determinationId]);
    expect(detRow.rows[0].status).toBe("adopted");
    expect(detRow.rows[0].adopted_by_user_id).toBe(configuredUserId);
    expect(detRow.rows[0].adopted_at).not.toBeNull();
    expect(detRow.rows[0].appeal_deadline_date).not.toBeNull();

    // AGENTS.md rule 12 proof: determinations_audit trigger (schema/core.sql)
    // wrote the audit_log row for us — actor is the official, action INSERT,
    // after_json.status = 'adopted'.
    const audit = await admin.query(
      `select actor_user_id, action, after_json from audit_log where entity_type = 'determination' and entity_id = $1 order by at asc`,
      [result.determinationId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    expect(audit.rows[0].actor_user_id).toBe(configuredUserId);
    expect(audit.rows[0].after_json.status).toBe("adopted");
  });

  it("already-adopted determination cannot be adopted again", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "adopt-twice", 200000, DAMAGE);
    await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    const first = await adoptDetermination(configuredJurisdictionId, configuredUserId, seeded.clientId, true);
    expect(first.ok).toBe(true);
    const second = await adoptDetermination(configuredJurisdictionId, configuredUserId, seeded.clientId, true);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("already_adopted");
  });

  it("unconfigured jurisdiction: adoption still succeeds, but appeal_deadline_date stays NULL — never an invented number of days", async () => {
    const seeded = await seedAssessment(unconfiguredJurisdictionId, unconfiguredUserId, "adopt-unconfigured", 200000, DAMAGE);
    // Seed damage directly since this jurisdiction's cost table version differs.
    await computeAndPersistCalculation(unconfiguredJurisdictionId, unconfiguredUserId, seeded.clientId);

    const result = await adoptDetermination(unconfiguredJurisdictionId, unconfiguredUserId, seeded.clientId, true);
    expect(result.ok).toBe(true);
    expect(result.appealWindowConfigured).toBe(false);
    expect(result.appealDeadlineDate).toBeNull();

    const detRow = await admin.query(`select status, appeal_deadline_date from determinations where id = $1`, [result.determinationId]);
    expect(detRow.rows[0].status).toBe("adopted");
    expect(detRow.rows[0].appeal_deadline_date).toBeNull();
  });
});

describe("supersedeDetermination — old row -> superseded (never deleted), new draft points at a fresh calculation", () => {
  it("requires a reason", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "supersede-no-reason", 200000, DAMAGE);
    await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    const adopted = await adoptDetermination(configuredJurisdictionId, configuredUserId, seeded.clientId, true);
    const result = await supersedeDetermination(configuredJurisdictionId, configuredUserId, adopted.determinationId as string, "");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("reason_required");
  });

  it("only an adopted (or contested) determination can be superseded", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "supersede-draft-only", 200000, DAMAGE);
    const initial = await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") throw new Error("expected ok");
    // Insert a draft determination directly (never adopted).
    const draft = await admin.query(
      `insert into determinations (structure_id, jurisdiction_id, calculation_id, status) values ($1, $2, $3, 'draft') returning id`,
      [seeded.structureId, configuredJurisdictionId, initial.calculation.id],
    );
    const result = await supersedeDetermination(configuredJurisdictionId, configuredUserId, draft.rows[0].id, "reason");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_adopted");
  });

  it("happy path: old row -> superseded (row still queryable, never deleted); new draft determination + fresh calculation row; audit chain intact", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "supersede-happy", 200000, DAMAGE);
    const initial = await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") throw new Error("expected ok");

    const adopted = await adoptDetermination(configuredJurisdictionId, configuredUserId, seeded.clientId, true);
    expect(adopted.ok).toBe(true);
    const oldDeterminationId = adopted.determinationId as string;

    const calcCountBefore = await admin.query(
      `select count(*)::int as n from calculations where assessment_id = $1`,
      [seeded.assessmentId],
    );

    const result = await supersedeDetermination(
      configuredJurisdictionId,
      configuredUserId,
      oldDeterminationId,
      "Owner appeal produced new evidence requiring re-review.",
    );
    expect(result.ok).toBe(true);
    expect(result.newClientId).toBe(seeded.clientId);
    expect(result.newDeterminationId).not.toBe(oldDeterminationId);

    // Old row: superseded, still exists (never deleted — the schema trigger
    // would reject a DELETE outright regardless, AGENTS.md rule 11).
    const oldRow = await admin.query(`select status from determinations where id = $1`, [oldDeterminationId]);
    expect(oldRow.rows.length).toBe(1);
    expect(oldRow.rows[0].status).toBe("superseded");

    // New row: draft, points at a FRESH calculation (a new row, not the same one).
    const newRow = await admin.query(`select status, calculation_id from determinations where id = $1`, [
      result.newDeterminationId,
    ]);
    expect(newRow.rows[0].status).toBe("draft");
    expect(newRow.rows[0].calculation_id).not.toBe(initial.calculation.id);

    const calcCountAfter = await admin.query(
      `select count(*)::int as n from calculations where assessment_id = $1`,
      [seeded.assessmentId],
    );
    expect(calcCountAfter.rows[0].n).toBe(calcCountBefore.rows[0].n + 1);

    // Audit chain: the old row's UPDATE to 'superseded' was captured by the
    // schema trigger (before_json.status='adopted', after_json.status='superseded').
    const audit = await admin.query(
      `select before_json, after_json from audit_log where entity_type = 'determination' and entity_id = $1 and action = 'UPDATE' order by at desc limit 1`,
      [oldDeterminationId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].before_json.status).toBe("adopted");
    expect(audit.rows[0].after_json.status).toBe("superseded");
  });
});

describe("getReviewDetail — every input visible", () => {
  it("returns the full breakdown: elements, GPS, water depth, value source, cost table, ratio+band", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "review-detail", 200000, DAMAGE);
    await admin.query(
      `update assessments set gps_lat = 40.05, gps_lng = -86.0, gps_accuracy_m = 5,
         water_depth_interior_in = 18, water_depth_source = 'measured', notes = 'Standing water observed.'
       where id = $1`,
      [seeded.assessmentId],
    );
    await computeAndPersistCalculation(configuredJurisdictionId, configuredUserId, seeded.clientId);

    const result = await getReviewDetail(configuredJurisdictionId, configuredUserId, seeded.clientId);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.detail.elements.length).toBe(12);
    expect(result.detail.gpsLat).toBe(40.05);
    expect(result.detail.waterDepthSource).toBe("measured");
    expect(result.detail.notes).toContain("Standing water");
    expect(result.detail.costTableVersion).toBe(configuredCostTableVersion);
    expect(result.detail.ratio).toBe(0.1963); // 39250/200000 = 0.19625 -> half-up 0.1963 (see test/unit/engine/persist.test.ts)
    expect(result.detail.thresholdResult).toBe("NOT_SD");
  });

  it("returns no_calculation (never fabricates) when nothing has been computed yet", async () => {
    const seeded = await seedAssessment(configuredJurisdictionId, configuredUserId, "review-detail-none", 200000, null);
    const result = await getReviewDetail(configuredJurisdictionId, configuredUserId, seeded.clientId);
    expect(result.status).toBe("no_calculation");
  });
});
