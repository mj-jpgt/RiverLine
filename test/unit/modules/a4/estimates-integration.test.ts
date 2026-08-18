import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import pg from "pg";
import { withDatabaseName, ensureDatabaseExists } from "../../../../scripts/db/ensure-database.mjs";
import { applyMigrations } from "../../../../scripts/db/migrate.mjs";
import { createEstimateVersion, confirmEstimate } from "../../../../src/modules/a4-estimates/actions";
import {
  getAssessmentEstimatesContext,
  getEstimateDetail,
  resolveEstimatePageStorageKey,
} from "../../../../src/modules/a4-estimates/queries";
import { requireRole, AuthError } from "../../../../src/core/auth/role-guard";
import type { SessionPayload } from "../../../../src/core/auth/session";
import type { CreateEstimateInput, ExtractedJson } from "../../../../src/modules/a4-estimates/types";

// Real Postgres, real writes, no mocks — same recipe every other module's
// integration suite uses (test/unit/modules/a3/export-integration.test.ts,
// test/unit/determination/persist.test.ts). Proves: RLS/tenant scoping via
// withTenant() (not app-level filtering — AGENTS.md "data / backend
// agents" rule 1), sha256 re-verification, and the version-chain
// (supersedes_estimate_id) logic — the three things this module's routes
// cannot honestly be tested through a mocked Request object (this
// codebase's own precedent: a3's own integration suite documents exactly
// why route-handler-level testing isn't done here — cookies()/next/headers
// need a real request context). AGENTS.md rule 6: only ever seeds
// riverline_test.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set — see .env.example. The A4 estimates suite needs riverline_test.");
}
const testUrl = withDatabaseName(baseUrl, "riverline_test");
process.env.DATABASE_URL = testUrl;

let admin: pg.Client;
let jurisdictionAId: string;
let jurisdictionBId: string;
let userAId: string;
let userBId: string;

function sha256Hex(base64: string): string {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function fakeJpegBase64(seed: string): string {
  // Real JPEG magic bytes (0xFF 0xD8 0xFF) followed by arbitrary
  // deterministic content — createEstimateVersion now signature-sniffs
  // every page (src/shared/security/upload-validation.ts's
  // sniffImageType(), wired in per docs/security-review.md's W3 audit), so
  // a fixture that doesn't start with a real JPEG signature would be
  // rejected as invalid_image_type. This module never decodes past the
  // signature server-side (only hashes and stores the bytes), so a real
  // header + arbitrary trailing bytes is sufficient and honest.
  return Buffer.concat([JPEG_MAGIC, Buffer.from(`fake-estimate-image-bytes-${seed}`)]).toString("base64");
}

async function seedAssessment(
  jurisdictionId: string,
  userId: string,
  addressLabel: string,
  improvementValue: number,
): Promise<{ clientId: string; assessmentId: string }> {
  const parcelId = `A4-TEST-${addressLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const s = await admin.query(
    `insert into structures (jurisdiction_id, parcel_id, address, improvement_value, assessor_market_value, value_source)
     values ($1, $2, $3, $4, $5, 'appraisal') returning id`,
    [jurisdictionId, parcelId, addressLabel, improvementValue, improvementValue * 1.2],
  );
  const structureId = s.rows[0].id as string;

  const clientId = `a4-test-${addressLabel}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const a = await admin.query(
    `insert into assessments (structure_id, jurisdiction_id, assessor_user_id, client_id, completed_at)
     values ($1, $2, $3, $4, now()) returning id`,
    [structureId, jurisdictionId, userId, clientId],
  );
  return { clientId, assessmentId: a.rows[0].id as string };
}

function buildUploadInput(pageSeeds: string[], extracted: ExtractedJson | null): CreateEstimateInput {
  return {
    pages: pageSeeds.map((seed, i) => {
      const dataBase64 = fakeJpegBase64(seed);
      return {
        sha256: sha256Hex(dataBase64),
        dataBase64,
        contentType: "image/jpeg" as const,
        originalFilename: `estimate-page-${i + 1}.jpg`,
        widthPx: 1200,
        heightPx: 1600,
      };
    }),
    extracted,
  };
}

beforeAll(async () => {
  await ensureDatabaseExists(testUrl);
  await applyMigrations(testUrl);

  admin = new pg.Client({ connectionString: testUrl });
  await admin.connect();

  const ja = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    "A4 Estimates Test Jurisdiction A",
  ]);
  jurisdictionAId = ja.rows[0].id;
  const ua = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor') returning id`,
    [`a4-test-a-${Date.now()}@example.gov`, jurisdictionAId],
  );
  userAId = ua.rows[0].id;

  const jb = await admin.query(`insert into jurisdictions (name) values ($1) returning id`, [
    "A4 Estimates Test Jurisdiction B",
  ]);
  jurisdictionBId = jb.rows[0].id;
  const ub = await admin.query(
    `insert into users (email, jurisdiction_id, role) values ($1, $2, 'assessor') returning id`,
    [`a4-test-b-${Date.now()}@example.gov`, jurisdictionBId],
  );
  userBId = ub.rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

describe("createEstimateVersion", () => {
  it("uploads a single-page estimate, re-verifies the hash, and writes an unconfirmed row", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "upload-house", 140000);
    const input = buildUploadInput(["p1"], null);

    const result = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, input);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.version).toBe(1);

    const detail = await getEstimateDetail(jurisdictionAId, userAId, result.estimateId);
    expect(detail).not.toBeNull();
    expect(detail?.isConfirmed).toBe(false);
    expect(detail?.pageCount).toBe(1);
    expect(detail?.supersedesEstimateId).toBeNull();
  });

  it("rejects an upload whose claimed sha256 does not match the actual bytes (never stores unverified bytes)", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "hash-mismatch-house", 140000);
    const input = buildUploadInput(["p1"], null);
    // Tamper with the claimed hash after computing the honest one.
    input.pages[0]!.sha256 = "0".repeat(64);

    const result = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, input);
    expect(result).toEqual({ status: "hash_mismatch", pageIndex: 0 });

    const context = await getAssessmentEstimatesContext(jurisdictionAId, userAId, target.clientId);
    expect(context?.versions).toHaveLength(0);
  });

  it("returns not_found for an unknown client_id", async () => {
    const input = buildUploadInput(["p1"], null);
    const result = await createEstimateVersion(jurisdictionAId, userAId, "no-such-client-id", input);
    expect(result).toEqual({ status: "not_found" });
  });

  it("re-uploading for the same assessment creates a new version with supersedes_estimate_id set — never merges (spec §8.3)", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "version-chain-house", 140000);

    const v1 = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["v1"], null));
    expect(v1.status).toBe("ok");
    if (v1.status !== "ok") throw new Error("unreachable");
    expect(v1.version).toBe(1);

    const v2 = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["v2"], null));
    expect(v2.status).toBe("ok");
    if (v2.status !== "ok") throw new Error("unreachable");
    expect(v2.version).toBe(2);

    const v2Detail = await getEstimateDetail(jurisdictionAId, userAId, v2.estimateId);
    expect(v2Detail?.supersedesEstimateId).toBe(v1.estimateId);

    const context = await getAssessmentEstimatesContext(jurisdictionAId, userAId, target.clientId);
    expect(context?.versions).toHaveLength(2);
    // Newest first.
    expect(context?.versions[0]?.id).toBe(v2.estimateId);
    expect(context?.versions[1]?.id).toBe(v1.estimateId);
    // v1's own row is untouched, not merged/overwritten.
    const v1DetailAfter = await getEstimateDetail(jurisdictionAId, userAId, v1.estimateId);
    expect(v1DetailAfter?.version).toBe(1);
  });

  it("stores a multi-page document as an ordered page list under one estimate row", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "multipage-house", 140000);
    const result = await createEstimateVersion(
      jurisdictionAId,
      userAId,
      target.clientId,
      buildUploadInput(["page1", "page2", "page3"], null),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");

    const detail = await getEstimateDetail(jurisdictionAId, userAId, result.estimateId);
    expect(detail?.pageCount).toBe(3);

    for (let i = 0; i < 3; i++) {
      const key = await resolveEstimatePageStorageKey(jurisdictionAId, userAId, result.estimateId, i);
      expect(key).toContain("/estimates/");
    }
    const missing = await resolveEstimatePageStorageKey(jurisdictionAId, userAId, result.estimateId, 5);
    expect(missing).toBeNull();
  });

  it("is tenant-scoped: jurisdiction B cannot upload against jurisdiction A's assessment (RLS hides it as not_found)", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "cross-tenant-upload-house", 140000);
    const result = await createEstimateVersion(jurisdictionBId, userBId, target.clientId, buildUploadInput(["x"], null));
    expect(result).toEqual({ status: "not_found" });
  });

  // docs/security-review.md's W3 audit (2026-08-17): this route previously
  // had no size cap or real signature check — a client-declared
  // `contentType: "image/jpeg"` was trusted outright. Both gaps are closed
  // in src/modules/a4-estimates/actions.ts via the SAME shared
  // src/shared/security/upload-validation.ts app/api/capture/sync/route.ts
  // already used (MAX_PHOTO_BYTES, sniffImageType) — these two tests prove
  // it, not just the wiring.
  it("rejects a page whose bytes are not a real JPEG, regardless of the claimed contentType (magic-byte sniff)", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "wrong-type-house", 140000);
    const input = buildUploadInput(["p1"], null);
    // Overwrite with bytes that do NOT start with the real JPEG signature
    // (0xFF 0xD8 0xFF) — a plain text payload masquerading as
    // contentType: "image/jpeg".
    const notAJpeg = Buffer.from("<html>not an image</html>");
    const dataBase64 = notAJpeg.toString("base64");
    input.pages[0]!.dataBase64 = dataBase64;
    input.pages[0]!.sha256 = createHash("sha256").update(notAJpeg).digest("hex");

    const result = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, input);
    expect(result).toEqual({ status: "invalid_image_type", pageIndex: 0 });

    const context = await getAssessmentEstimatesContext(jurisdictionAId, userAId, target.clientId);
    expect(context?.versions).toHaveLength(0);
  });

  it("rejects a page that exceeds the per-photo size cap (MAX_PHOTO_BYTES, 8MB)", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "oversized-house", 140000);
    const oversized = Buffer.concat([JPEG_MAGIC, Buffer.alloc(8 * 1024 * 1024 + 1, 0x01)]);
    const dataBase64 = oversized.toString("base64");

    const input: CreateEstimateInput = {
      pages: [
        {
          sha256: createHash("sha256").update(oversized).digest("hex"),
          dataBase64,
          contentType: "image/jpeg",
          originalFilename: "huge.jpg",
          widthPx: 1200,
          heightPx: 1600,
        },
      ],
      extracted: null,
    };

    const result = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, input);
    expect(result).toEqual({ status: "too_large", pageIndex: 0 });

    const context = await getAssessmentEstimatesContext(jurisdictionAId, userAId, target.clientId);
    expect(context?.versions).toHaveLength(0);
  });
});

describe("confirmEstimate", () => {
  it("confirms with OCR-assisted provenance and stores the confirmed fields", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "confirm-ocr-house", 140000);
    const upload = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["p1"], null));
    if (upload.status !== "ok") throw new Error("unreachable");

    const result = await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: 12500,
      confirmedLineItems: [{ description: "Roof", amountDollars: 12500 }],
      scopeReviewed: true,
      provenance: "ocr_assisted",
      notes: null,
    });
    expect(result).toEqual({ status: "ok" });

    const detail = await getEstimateDetail(jurisdictionAId, userAId, upload.estimateId);
    expect(detail?.isConfirmed).toBe(true);
    expect(detail?.confirmedTotal).toBe(12500);
    expect(detail?.confirmedLineItems).toEqual([{ description: "Roof", amountDollars: 12500 }]);
    expect(detail?.scopeReviewed).toBe(true);
    expect(detail?.confirmedByEmail).toContain("a4-test-a-");

    const auditRes = await admin.query(
      `select action, after_json from audit_log where entity_type = 'estimate' and entity_id = $1`,
      [upload.estimateId],
    );
    expect(auditRes.rows).toHaveLength(1);
    expect(auditRes.rows[0].action).toBe("confirm");
  });

  it("provenance is manual_entry when no OCR extraction exists on the row", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "confirm-manual-house", 140000);
    const upload = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["p1"], null));
    if (upload.status !== "ok") throw new Error("unreachable");

    await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: 9000,
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: "Hand-entered from a faxed copy.",
    });

    const detail = await getEstimateDetail(jurisdictionAId, userAId, upload.estimateId);
    expect(detail?.provenance).toBe("manual_entry");
    expect(detail?.notes).toBe("Hand-entered from a faxed copy.");
  });

  it("rejects confirmation when scope_reviewed is false — server-side, not just a client-side gate", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "confirm-scope-house", 140000);
    const upload = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["p1"], null));
    if (upload.status !== "ok") throw new Error("unreachable");

    const result = await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: 5000,
      confirmedLineItems: [],
      scopeReviewed: false,
      provenance: "manual_entry",
      notes: null,
    });
    expect(result).toEqual({ status: "scope_not_reviewed" });

    const detail = await getEstimateDetail(jurisdictionAId, userAId, upload.estimateId);
    expect(detail?.isConfirmed).toBe(false);
  });

  it("rejects a zero or negative confirmed total server-side", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "confirm-invalid-total-house", 140000);
    const upload = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["p1"], null));
    if (upload.status !== "ok") throw new Error("unreachable");

    const zero = await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: 0,
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: null,
    });
    expect(zero).toEqual({ status: "invalid_total" });

    const negative = await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: -500,
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: null,
    });
    expect(negative).toEqual({ status: "invalid_total" });
  });

  it("refuses to re-confirm an already-confirmed version — a correction must be a new version, never an overwrite", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "confirm-twice-house", 140000);
    const upload = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["p1"], null));
    if (upload.status !== "ok") throw new Error("unreachable");

    const first = await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: 1000,
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: null,
    });
    expect(first).toEqual({ status: "ok" });

    const second = await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: 99999,
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: null,
    });
    expect(second).toEqual({ status: "already_confirmed" });

    // The original confirmed value is untouched by the rejected second call.
    const detail = await getEstimateDetail(jurisdictionAId, userAId, upload.estimateId);
    expect(detail?.confirmedTotal).toBe(1000);
  });

  it("returns not_found for an unknown estimate id", async () => {
    const result = await confirmEstimate(jurisdictionAId, userAId, "00000000-0000-0000-0000-000000000000", {
      confirmedTotal: 100,
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: null,
    });
    expect(result).toEqual({ status: "not_found" });
  });

  it("is tenant-scoped: jurisdiction B cannot confirm jurisdiction A's estimate", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "cross-tenant-confirm-house", 140000);
    const upload = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["p1"], null));
    if (upload.status !== "ok") throw new Error("unreachable");

    const result = await confirmEstimate(jurisdictionBId, userBId, upload.estimateId, {
      confirmedTotal: 100,
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: null,
    });
    expect(result).toEqual({ status: "not_found" });
  });

  it("flags sanityFlag on the summary when confirmed total exceeds 3x improvement value", async () => {
    const target = await seedAssessment(jurisdictionAId, userAId, "sanity-flag-house", 140000);
    const upload = await createEstimateVersion(jurisdictionAId, userAId, target.clientId, buildUploadInput(["p1"], null));
    if (upload.status !== "ok") throw new Error("unreachable");

    await confirmEstimate(jurisdictionAId, userAId, upload.estimateId, {
      confirmedTotal: 500000, // > 3 * 140000 = 420000
      confirmedLineItems: [],
      scopeReviewed: true,
      provenance: "manual_entry",
      notes: null,
    });

    const context = await getAssessmentEstimatesContext(jurisdictionAId, userAId, target.clientId);
    const version = context?.versions.find((v) => v.id === upload.estimateId);
    expect(version?.sanityFlag).toBe(true);
  });
});

describe("role gate — the exact mechanism the upload/confirm routes call", () => {
  const assessorSession: SessionPayload = { userId: "u1", jurisdictionId: "j1", role: "assessor", email: "a@x.gov", iat: 0, exp: 0 };
  const viewerSession: SessionPayload = { userId: "u2", jurisdictionId: "j1", role: "viewer", email: "v@x.gov", iat: 0, exp: 0 };
  const officialSession: SessionPayload = { userId: "u3", jurisdictionId: "j1", role: "official", email: "o@x.gov", iat: 0, exp: 0 };

  it("allows assessor and official; rejects viewer with FORBIDDEN", () => {
    expect(requireRole(assessorSession, ["admin", "assessor", "official"])).toBe(assessorSession);
    expect(requireRole(officialSession, ["admin", "assessor", "official"])).toBe(officialSession);
    try {
      requireRole(viewerSession, ["admin", "assessor", "official"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("FORBIDDEN");
    }
  });

  it("rejects no session with UNAUTHENTICATED", () => {
    try {
      requireRole(null, ["admin", "assessor", "official"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("UNAUTHENTICATED");
    }
  });
});
