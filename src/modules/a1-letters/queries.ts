// Read-only queries for the A1 letters module. Every query is
// jurisdiction-scoped through withTenant() (RLS-enforced), same pattern
// src/core/determination/queries.ts already establishes.
import type { PoolClient } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withTenant } from "@/shared/db";
import { buildLetterFacts, isNonEmptyOrdinanceCitation } from "./pure";
import type { LetterPreviewResult, ThresholdResultForLetter } from "./types";

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function readLetterheadAddressLines(letterheadConfig: unknown): string[] | null {
  if (typeof letterheadConfig !== "object" || letterheadConfig === null) return null;
  const value = (letterheadConfig as Record<string, unknown>).address_lines;
  if (!Array.isArray(value)) return null;
  const lines = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return lines.length > 0 ? lines : null;
}

function readIccText(letterheadConfig: unknown): string | null {
  if (typeof letterheadConfig !== "object" || letterheadConfig === null) return null;
  const value = (letterheadConfig as Record<string, unknown>).icc_text;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readLetterheadName(letterheadConfig: unknown, fallback: string): string {
  if (typeof letterheadConfig === "object" && letterheadConfig !== null) {
    const value = (letterheadConfig as Record<string, unknown>).letterhead_name;
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return fallback;
}

/**
 * Resolves the full letter-generation state for one assessment (by
 * client_id, matching the URL scheme app/calculation and app/determination
 * already use). Returns exactly one of the explicit states in
 * LetterPreviewResult — never renders a letter for anything but an adopted,
 * definite (SD/NOT_SD) determination whose jurisdiction has a real,
 * human-entered ordinance citation on file.
 */
export async function getLetterPreview(
  jurisdictionId: string,
  userId: string | null,
  clientId: string,
): Promise<LetterPreviewResult> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const assessmentRes = await client.query(
      `select a.id as assessment_id, a.completed_at, s.id as structure_id, s.address, s.parcel_id
       from assessments a
       join structures s on s.id = a.structure_id
       where a.client_id = $1`,
      [clientId],
    );
    if (assessmentRes.rows.length === 0) return { status: "not_found" };
    const a = assessmentRes.rows[0];
    const assessmentId = a.assessment_id as string;

    const determinationRes = await client.query(
      `select d.id, d.status, d.adopted_at, d.adopted_by_user_id, d.appeal_deadline_date, d.letter_id,
              c.ratio, c.threshold_result
       from determinations d
       join calculations c on c.id = d.calculation_id
       where c.assessment_id = $1
       order by d.created_at desc
       limit 1`,
      [assessmentId],
    );
    if (determinationRes.rows.length === 0) return { status: "no_determination" };
    const det = determinationRes.rows[0];
    if (det.status !== "adopted") return { status: "no_determination" };

    const thresholdResult = det.threshold_result as "SD" | "NOT_SD" | "BORDERLINE";
    if (thresholdResult === "BORDERLINE") return { status: "borderline_unresolved" };

    const jurisdictionRes = await client.query(
      `select name, ordinance_citation, letterhead_config from jurisdictions where id = $1`,
      [jurisdictionId],
    );
    const jur = jurisdictionRes.rows[0] as
      | { name: string; ordinance_citation: string | null; letterhead_config: unknown }
      | undefined;
    if (!jur) return { status: "not_found" };

    if (!isNonEmptyOrdinanceCitation(jur.ordinance_citation)) {
      return { status: "citation_missing", jurisdictionId, jurisdictionName: jur.name };
    }

    const officialRes = await client.query(`select email from users where id = $1`, [det.adopted_by_user_id]);
    const officialEmail = (officialRes.rows[0]?.email as string | undefined) ?? "unknown";

    const facts = buildLetterFacts({
      jurisdictionName: readLetterheadName(jur.letterhead_config, jur.name),
      letterheadAddressLines: readLetterheadAddressLines(jur.letterhead_config),
      structureAddress: a.address as string,
      parcelId: a.parcel_id as string,
      assessmentCompletedAtIso: toIso(a.completed_at),
      ratio: Number(det.ratio),
      thresholdResult: thresholdResult as ThresholdResultForLetter,
      ordinanceCitation: jur.ordinance_citation,
      appealDeadlineDateIso: det.appeal_deadline_date
        ? (det.appeal_deadline_date instanceof Date
            ? det.appeal_deadline_date.toISOString().slice(0, 10)
            : String(det.appeal_deadline_date))
        : null,
      officialEmail,
      adoptedAtIso: toIso(det.adopted_at),
      iccText: readIccText(jur.letterhead_config),
    });

    if (det.letter_id) {
      const letterRes = await client.query(`select id, issued_at, pdf_storage_key from letters where id = $1`, [
        det.letter_id,
      ]);
      const letter = letterRes.rows[0] as { id: string; issued_at: unknown; pdf_storage_key: string } | undefined;
      if (letter) {
        return {
          status: "issued",
          determinationId: det.id as string,
          jurisdictionId,
          letterId: letter.id,
          issuedAt: toIso(letter.issued_at),
          storageKey: letter.pdf_storage_key,
          facts,
        };
      }
    }

    return { status: "ready", determinationId: det.id as string, jurisdictionId, facts };
  });
}

/** Reads the archived HTML letter off disk. storage_key is content-scoped
 * (letters/<jurisdictionId>/<letterId>.html) and only ever written by
 * actions.ts's issueLetter — never derived from unsanitized input, so a
 * direct path.join is safe (same pattern app/api/photos/[id]/route.ts
 * already uses). */
export async function readArchivedLetterHtml(storageKey: string): Promise<string> {
  const filePath = path.join(UPLOADS_ROOT, storageKey);
  return readFile(filePath, "utf8");
}
