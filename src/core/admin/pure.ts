// Pure, zero-I/O helpers for src/core/admin: validation only, no DB access
// (same split queries.ts/actions.ts already establish for every other core
// family — src/core/determination/pure.ts, src/modules/a1-letters/pure.ts).
//
// The cost-table element-code set comes from src/core/capture/elements.ts
// (RESIDENTIAL_ELEMENTS / NON_RESIDENTIAL_ELEMENTS), which is itself
// verbatim from docs/data-contracts/sde-cost-tables.md — never redeclared
// here, so there is exactly one place in the codebase that lists the 12
// residential / 7 non-residential SDE codes.
import { z } from "zod";
import { RESIDENTIAL_ELEMENTS, NON_RESIDENTIAL_ELEMENTS } from "@/core/capture";
import type { CostTablePayload, UserRole } from "./types";
import { ROLES } from "./types";

export const RESIDENTIAL_CODES: readonly string[] = RESIDENTIAL_ELEMENTS.map((e) => e.code);
export const NON_RESIDENTIAL_CODES: readonly string[] = NON_RESIDENTIAL_ELEMENTS.map((e) => e.code);

/** Same non-empty check src/modules/a1-letters/pure.ts uses for
 * ordinance_citation — duplicated as a 1-line pure function rather than
 * imported, because eslint-plugin-boundaries forbids a core family from
 * importing a modules family (docs/adr/0003-module-boundary-enforcement.md;
 * modules -> core is allowed, core -> modules is not). Not a domain fact,
 * just a string-emptiness check. */
export function isNonEmptyText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Minimum length for cost_tables.source_citation, enforced server-side
 * (task instructions: "REQUIRED, non-empty, min length enforced
 * server-side — a cost table without a citation must be REJECTED, per
 * AGENTS.md rules 4/5"). 20 characters is not itself a sourced fact — it's
 * a placeholder-guard chosen so a single word ("guide", "n/a", "TBD")
 * cannot pass, while a real citation ("Marshall & Swift Residential Cost
 * Handbook, 2026 ed., p. 42" — 57 chars) clears it comfortably. This does
 * NOT replace human review of the citation's content; it only blocks the
 * emptiest placeholders. See docs/journal/2026-08-17-w5-admin.md. */
export const MIN_SOURCE_CITATION_LENGTH = 20;

export function isValidSourceCitation(value: string): boolean {
  return value.trim().length >= MIN_SOURCE_CITATION_LENGTH;
}

export function isValidAppealWindowDays(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function isValidEffectiveDateIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function elementShape(codes: readonly string[]): z.ZodRawShape {
  const entries = codes.map((code) => [
    code,
    z
      .number({ error: `"${code}" must be a number (dollars per square foot).` })
      .finite(`"${code}" must be a finite number.`)
      .min(0, `"${code}" must be zero or greater.`),
  ] as const);
  return Object.fromEntries(entries);
}

/** The exact, strict shape the engine expects (src/core/engine/types.ts's
 * EngineCostTable['base_cost_per_sqft']): every one of the 12 residential
 * and 7 non-residential SDE codes present, numeric, non-negative, and NO
 * other keys (an unrecognized code would silently never be read by the
 * engine, which validates element codes against the cost table's own key
 * set — better to reject it loudly here than have it look "saved" and do
 * nothing at calculation time). Used by BOTH entry modes (per-element form
 * inputs and pasted/uploaded JSON) so there is one validator, not two. */
// z.object(...).strict() does not accept a custom message in the installed
// zod version's types (v4.4.3) — the default "Unrecognized key: ..." issue
// message is still a usable per-field error (parseCostTablePayload below
// surfaces it verbatim), so no custom text is passed here.
export const costTablePayloadSchema = z
  .object({
    residential: z.object(elementShape(RESIDENTIAL_CODES)).strict(),
    non_residential: z.object(elementShape(NON_RESIDENTIAL_CODES)).strict(),
  })
  .strict();

export interface PayloadValidationResult {
  ok: boolean;
  value?: CostTablePayload;
  fieldErrors: string[];
}

/** Validates a candidate cost-table payload (from either entry mode) and
 * returns per-field messages a form can show next to the offending input,
 * or a single message per JSON-mode error. Never returns `ok: true` for a
 * payload missing any required element code. */
export function parseCostTablePayload(candidate: unknown): PayloadValidationResult {
  const result = costTablePayloadSchema.safeParse(candidate);
  if (result.success) {
    return { ok: true, value: result.data as CostTablePayload, fieldErrors: [] };
  }
  const fieldErrors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { ok: false, fieldErrors };
}

// ---------------------------------------------------------------------------
// G3: team user management
// ---------------------------------------------------------------------------

/** Normalized email format check — matches the shape requestMagicLink
 * already normalizes to (trim + lowercase) before ever touching the
 * database, so a user created here is always found by the exact string a
 * real magic-link/sign-in-link request will look up. Not a full RFC 5322
 * validator (nothing in this codebase needs one) — same pragmatic level
 * app/api/auth/request-link/route.ts's zod schema (`z.string().email()`)
 * already accepts for this exact allowlist. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export function isValidUserRole(value: string): value is UserRole {
  return (ROLES as readonly string[]).includes(value);
}

// ROLE_DESCRIPTIONS (the plain-language "Add a team member" copy) lives in
// src/shared/roles.ts, not here — see that file's comment. src/core/admin/
// index.ts re-exports it from there for server-side consumers.
