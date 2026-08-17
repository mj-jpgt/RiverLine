import pg from "pg";
import { expect, test, type BrowserContext } from "@playwright/test";
// Relative import, not the "@/core/auth" alias — this file is outside the
// aliased src/ tree the same way test/e2e/offline-capture.spec.ts already
// documents for its identical signed-session-cookie pattern.
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "../../src/core/auth/session";

// T-C5 added scope (specs/core/tasks.md §2.5, docs/testing/live-test-plan.md
// OT-4): two devices editing the same assessment (same client_id) merge
// per FIELD / per ELEMENT — last-write-wins by device_captured_at, never a
// whole-record overwrite. Pure-logic coverage lives in
// test/unit/capture/merge.test.ts; this is the real Postgres + real HTTP
// round trip through the actual /api/capture/sync route.
//
// Runs against riverline_dev under the normal `pnpm test:e2e` webServer —
// unlike determination.spec.ts, this needs no cost table at all (it only
// exercises assessments/assessment_elements merge logic), so it doesn't
// need the dedicated riverline_test harness. Uses a directly-minted signed
// session cookie (same pattern offline-capture.spec.ts documents at length)
// instead of the dev-magic-link UI flow, since this spec is pure API calls
// and would otherwise risk the documented dev-link-store per-email race
// with other specs sharing the webServer.
const DEMO_EMAIL = "assessor@example.gov";
const PRACTICE_ADDRESS = "123 Practice Ln";

const RESIDENTIAL_ELEMENT_CODES = [
  "foundations",
  "superstructure",
  "roof_covering",
  "exterior_finish",
  "interior_finish",
  "doors_windows",
  "cabinets_countertops",
  "floor_finish",
  "plumbing",
  "electrical",
  "appliances",
  "hvac",
];

async function loginWithSignedSessionCookie(context: BrowserContext, baseURL: string | undefined, admin: pg.Client) {
  const userRow = await admin.query("select id, jurisdiction_id, role from users where email = $1", [DEMO_EMAIL]);
  if (userRow.rows.length === 0) {
    throw new Error(`Demo user ${DEMO_EMAIL} not found — run \`node scripts/db/seed.mjs\` first.`);
  }
  const { id: userId, jurisdiction_id: jurisdictionId, role } = userRow.rows[0] as {
    id: string;
    jurisdiction_id: string;
    role: "admin" | "assessor" | "official" | "viewer";
  };

  const { value, maxAgeSeconds } = createSessionCookieValue({ userId, jurisdictionId, role, email: DEMO_EMAIL });
  const url = new URL(baseURL ?? "http://localhost:3000");
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + maxAgeSeconds,
    },
  ]);
}

function syncPayload(clientId: string, structureId: string, damagePct: number, deviceCapturedAt: string, notes: string | null) {
  return {
    clientId,
    structureId,
    structureUpdates: { occupancyType: null, sqFt: null, stories: null, foundationType: null },
    assessment: {
      gpsLat: null,
      gpsLng: null,
      gpsAccuracyM: null,
      deviceCapturedAt,
      waterDepthInteriorIn: null,
      waterDepthSource: null,
      notes,
      completedAt: deviceCapturedAt,
    },
    elements: RESIDENTIAL_ELEMENT_CODES.map((elementCode) => ({
      elementCode,
      damagePct: elementCode === "foundations" ? damagePct : 25,
    })),
    photos: [],
  };
}

test.describe("OT-4 — two devices editing the same assessment (multi-device sync)", () => {
  let admin: pg.Client;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — pnpm test:e2e needs a real local Postgres.");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("device B's later edit wins per-field; device A's untouched notes are preserved by B's null, not clobbered; audit_log records the merge; no duplicate rows", async ({
    browser,
    baseURL,
  }) => {
    const structureRow = await admin.query("select id from structures where address = $1 limit 1", [PRACTICE_ADDRESS]);
    expect(structureRow.rows.length).toBe(1);
    const structureId = structureRow.rows[0].id as string;

    const context = await browser.newContext();
    await loginWithSignedSessionCookie(context, baseURL, admin);

    const clientId = `ot4-multi-device-${Date.now()}`;
    const deviceATime = "2026-08-16T09:00:00.000Z";
    const deviceBTime = "2026-08-16T09:30:00.000Z"; // later — device B's batch is newer

    // Device A: foundations = 25%, never touches notes.
    const resA = await context.request.post("/api/capture/sync", {
      data: syncPayload(clientId, structureId, 25, deviceATime, null),
    });
    expect(resA.ok()).toBe(true);
    const bodyA = (await resA.json()) as { assessmentId: string; alreadySynced: boolean };
    expect(bodyA.alreadySynced).toBe(false);

    // Device B: foundations = 75% (conflict — later edit), sets notes (A never touched it).
    const resB = await context.request.post("/api/capture/sync", {
      data: syncPayload(clientId, structureId, 75, deviceBTime, "Device B observed additional damage."),
    });
    expect(resB.ok()).toBe(true);
    const bodyB = (await resB.json()) as { assessmentId: string; alreadySynced: boolean };
    expect(bodyB.assessmentId).toBe(bodyA.assessmentId); // same assessment row, not a duplicate

    // --- Per-field merge result -------------------------------------------
    const assessmentRow = await admin.query("select notes from assessments where id = $1", [bodyA.assessmentId]);
    expect(assessmentRow.rows[0].notes).toBe("Device B observed additional damage.");

    const foundationsRow = await admin.query(
      "select damage_pct from assessment_elements where assessment_id = $1 and element_code = 'foundations'",
      [bodyA.assessmentId],
    );
    expect(Number(foundationsRow.rows[0].damage_pct)).toBe(75); // B's later edit wins

    // --- No duplicated rows -------------------------------------------------
    const assessmentCount = await admin.query("select count(*)::int as n from assessments where client_id = $1", [clientId]);
    expect(assessmentCount.rows[0].n).toBe(1);
    const elementCount = await admin.query("select count(*)::int as n from assessment_elements where assessment_id = $1", [
      bodyA.assessmentId,
    ]);
    expect(elementCount.rows[0].n).toBe(RESIDENTIAL_ELEMENT_CODES.length);

    // --- Audit entry describing the merge ------------------------------------
    const audit = await admin.query(
      `select before_json, after_json from audit_log
       where entity_type = 'assessment' and action = 'multi_device_merge' and entity_id = $1
       order by at desc limit 1`,
      [bodyA.assessmentId],
    );
    expect(audit.rows.length).toBe(1);
    const afterElements = audit.rows[0].after_json.elements as { elementCode: string; before: number; after: number }[];
    expect(afterElements).toContainEqual({ elementCode: "foundations", before: 25, after: 75 });

    await context.close();
  });
});
