import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../../scripts/db/migrate.mjs";
import { computeAndPersistCalculation } from "../../../../app/calculation/_lib/compute";
import { adoptDetermination } from "../../../../app/determination/_lib/actions";
import { getLetterPreview, issueLetter, setOrdinanceCitation } from "../../../../src/modules/a1-letters";
import costTableFixture from "../../../fixtures/engine/cost-table.test-fixture-v0.json";

// Real Postgres, real writes, no mocks — proves T-A1's core invariant:
// letter generation refuses explicitly when jurisdictions.ordinance_citation
// is null, and only ever renders for an adopted, definite (SD/NOT_SD)
// determination once a human enters a real citation.
// AGENTS.md rule 6: this suite only ever seeds riverline_test.

const TEST_CITATION = "TEST ORDINANCE §00-000 — fixture, not legal text";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The letters persistence suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionId: string;
let officialUserId: string;
let adminUserId: string;

const DAMAGE: Record<string, number> = {
  foundations: 25,
  superstructure: 50,
  roof_covering: 100,
  interior_finish: 75,
  floor_finish: 50,
  plumbing: 25,
  electrical: 25,
};

async function seedCostTable(jid: string): Promise<void> {
  const version = `${costTableFixture.version}-a1-${jid}`;
  await admin.query(
    `insert into cost_tables (version, jurisdiction_id, source_citation, effective_date, json_payload)
     values ($1, $2, $3, $4, $5)
     on conflict (version) do nothing`,
    [
      version,
      jid,
      costTableFixture.source_citation,
      costTableFixture.effective_date,
      JSON.stringify({ base_cost_per_sqft: costTableFixture.base_cost_per_sqft }),
    ],
  );
}

async function seedAdoptedAssessment(
  label: string,
  marketValue: number,
): Promise<{ clientId: string; assessmentId: string }> {
  const parcelId = `A1-TEST-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const s = await admin.query(
    `insert into structures (
       jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft
     ) values ($1, $2, $3, $4, 'appraisal', 'residential', 1000) returning id`,
    [jurisdictionId, parcelId, `${label} Test Ave`, marketValue],
  );
  const structureId = s.rows[0].id as string;

  const clientId = `a1-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const a = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
     values ($1, $2, $3, $4, now()) returning id`,
    [structureId, jurisdictionId, officialUserId, clientId],
  );
  const assessmentId = a.rows[0].id as string;

  for (const [code, pct] of Object.entries(DAMAGE)) {
    await admin.query(
      `insert into assessment_elements (assessment_id, jurisdiction_id, element_code, damage_pct, cost_table_version)
       values ($1, $2, $3, $4, 'NONE')`,
      [assessmentId, jurisdictionId, code, pct],
    );
  }

  const computed = await computeAndPersistCalculation(jurisdictionId, officialUserId, clientId);
  expect(computed.status).toBe("ok");

  const adopted = await adoptDetermination(jurisdictionId, officialUserId, clientId, true);
  expect(adopted.ok).toBe(true);

  return { clientId, assessmentId };
}

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  // Real, honest default: ordinance_citation NULL, exactly as
  // scripts/db/seed.mjs seeds every real jurisdiction — never fabricated.
  const j = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    `A1 Letters Test Jurisdiction ${Date.now()}`,
  ]);
  jurisdictionId = j.rows[0].id;
  await seedCostTable(jurisdictionId);

  const ou = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'official') returning id`,
    [`a1-test-official-${Date.now()}@example.gov`, jurisdictionId],
  );
  officialUserId = ou.rows[0].id;

  const au = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'admin') returning id`,
    [`a1-test-admin-${Date.now()}@example.gov`, jurisdictionId],
  );
  adminUserId = au.rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

describe("getLetterPreview — refusal logic when ordinance_citation is null", () => {
  it("returns citation_missing for an adopted, definite determination when the jurisdiction has no ordinance citation on file", async () => {
    const { clientId } = await seedAdoptedAssessment("refusal-notsd", 200000);
    const preview = await getLetterPreview(jurisdictionId, officialUserId, clientId);
    expect(preview.status).toBe("citation_missing");
  });

  it("returns no_determination when there is no adopted determination", async () => {
    const parcelId = `A1-TEST-noadopt-${Date.now()}`;
    const s = await admin.query(
      `insert into structures (jurisdiction_id, parcel_id, address, assessor_market_value, value_source, occupancy_type, sq_ft)
       values ($1, $2, $3, $4, 'appraisal', 'residential', 1000) returning id`,
      [jurisdictionId, parcelId, "No Adopt Ave", 200000],
    );
    const clientId = `a1-test-noadopt-${Date.now()}`;
    await admin.query(
      `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
       values ($1, $2, $3, $4, now())`,
      [s.rows[0].id, jurisdictionId, officialUserId, clientId],
    );
    const preview = await getLetterPreview(jurisdictionId, officialUserId, clientId);
    expect(preview.status).toBe("no_determination");
  });

  it("returns borderline_unresolved for an adopted determination whose ratio is in the borderline band", async () => {
    const { clientId } = await seedAdoptedAssessment("refusal-borderline", 80000);
    const preview = await getLetterPreview(jurisdictionId, officialUserId, clientId);
    expect(preview.status).toBe("borderline_unresolved");
  });

  it("issueLetter refuses (not_ready) while the citation is missing, and creates no letters row", async () => {
    const { clientId } = await seedAdoptedAssessment("refusal-issue-blocked", 210000);
    const before = await admin.query(`select count(*)::int as n from letters`);
    const result = await issueLetter(jurisdictionId, officialUserId, clientId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_ready");
    const after = await admin.query(`select count(*)::int as n from letters`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe("setOrdinanceCitation — admin-only path, audited", () => {
  it("rejects an empty citation", async () => {
    const result = await setOrdinanceCitation(jurisdictionId, adminUserId, {
      ordinanceCitation: "   ",
      appealWindowDays: null,
      letterheadName: null,
      letterheadAddressLines: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("citation_required");
  });

  it("rejects a non-positive appeal window", async () => {
    const result = await setOrdinanceCitation(jurisdictionId, adminUserId, {
      ordinanceCitation: TEST_CITATION,
      appealWindowDays: -5,
      letterheadName: null,
      letterheadAddressLines: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_appeal_window");
  });

  it("writes the citation + appeal window, and audits before/after on the jurisdiction row", async () => {
    const before = await admin.query(`select ordinance_citation from jurisdictions where id = $1`, [jurisdictionId]);
    expect(before.rows[0].ordinance_citation).toBeNull();

    const result = await setOrdinanceCitation(jurisdictionId, adminUserId, {
      ordinanceCitation: TEST_CITATION,
      appealWindowDays: 30,
      letterheadName: null,
      letterheadAddressLines: null,
    });
    expect(result.ok).toBe(true);

    const after = await admin.query(
      `select ordinance_citation, letterhead_config from jurisdictions where id = $1`,
      [jurisdictionId],
    );
    expect(after.rows[0].ordinance_citation).toBe(TEST_CITATION);
    expect(after.rows[0].letterhead_config.appeal_window_days).toBe(30);

    const audit = await admin.query(
      `select before_json, after_json, actor_user_id from audit_log
       where entity_type = 'jurisdiction' and action = 'set_ordinance_and_letterhead'
       order by at desc limit 1`,
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].actor_user_id).toBe(adminUserId);
    expect(audit.rows[0].before_json.ordinance_citation).toBeNull();
    expect(audit.rows[0].after_json.ordinance_citation).toBe(TEST_CITATION);
  });
});

describe("getLetterPreview / issueLetter — once the citation is on file", () => {
  it("getLetterPreview now returns ready, with the citation carried through to facts", async () => {
    const { clientId } = await seedAdoptedAssessment("ready-notsd", 190000);
    const preview = await getLetterPreview(jurisdictionId, officialUserId, clientId);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") throw new Error("expected ready");
    expect(preview.facts.ordinanceCitation).toBe(TEST_CITATION);
    expect(preview.facts.thresholdResult).toBe("NOT_SD");
  });

  it("issueLetter creates a letters row, links determinations.letter_id, archives the HTML, and audits", async () => {
    const { clientId } = await seedAdoptedAssessment("issue-sd", 58000);
    const preview = await getLetterPreview(jurisdictionId, officialUserId, clientId);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") throw new Error("expected ready");

    const result = await issueLetter(jurisdictionId, officialUserId, clientId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const letterRow = await admin.query(`select id, determination_id, template_version, pdf_storage_key, issued_at from letters where id = $1`, [
      result.letterId,
    ]);
    expect(letterRow.rows.length).toBe(1);
    expect(letterRow.rows[0].determination_id).toBe(preview.determinationId);
    expect(letterRow.rows[0].issued_at).not.toBeNull();

    const determinationRow = await admin.query(`select letter_id from determinations where id = $1`, [
      preview.determinationId,
    ]);
    expect(determinationRow.rows[0].letter_id).toBe(result.letterId);

    const audit = await admin.query(
      `select actor_user_id from audit_log where entity_type = 'letter' and action = 'issue' and entity_id = $1`,
      [result.letterId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].actor_user_id).toBe(officialUserId);

    const archived = await readFile(path.join(process.cwd(), "uploads", result.storageKey!), "utf8");
    expect(archived).toContain(TEST_CITATION);
    expect(archived).toContain("IS substantially damaged");
    expect(archived).not.toContain("PREVIEW");

    const secondAttempt = await issueLetter(jurisdictionId, officialUserId, clientId);
    expect(secondAttempt.ok).toBe(false);
    expect(secondAttempt.error).toBe("already_issued");

    const previewAfterIssue = await getLetterPreview(jurisdictionId, officialUserId, clientId);
    expect(previewAfterIssue.status).toBe("issued");
  });
});
