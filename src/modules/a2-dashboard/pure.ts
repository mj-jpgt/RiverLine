// Pure, zero-I/O helpers for the T-A2 dashboard — unit-testable without
// Postgres, same split queries.ts/pure.ts pattern as
// src/core/determination. Everything that turns a request's raw
// query-string values into SQL goes through a hard whitelist here so a
// crafted `?sort=` or `?status=` value can never reach the query string
// (task instructions: "no SQL injection via sort/filter params — whitelist
// columns").

import type {
  BandFilter,
  CaseloadSortColumn,
  DeterminationStatus,
  SortDirection,
  StatusFilter,
} from "./types";

/** The ONLY sort columns a request may select, mapped to their real,
 * trusted SQL expression. A request's `sort` value is looked up in this
 * object; anything not a literal key here is impossible to reach the query
 * — there is no string concatenation path from user input to SQL. */
export const SORT_COLUMN_SQL: Record<CaseloadSortColumn, string> = {
  address: "s.address",
  parcel_id: "s.parcel_id",
  ratio: "lc.ratio",
  completed_at: "la.completed_at",
  status: "ld.status",
  band: "lc.threshold_result",
};

const SORT_COLUMNS = Object.keys(SORT_COLUMN_SQL) as CaseloadSortColumn[];

const DEFAULT_DIRECTION: Record<CaseloadSortColumn, SortDirection> = {
  address: "asc",
  parcel_id: "asc",
  ratio: "desc",
  completed_at: "desc",
  status: "asc",
  band: "asc",
};

export function isSortColumn(value: unknown): value is CaseloadSortColumn {
  return typeof value === "string" && (SORT_COLUMNS as string[]).includes(value);
}

/** Resolves an untrusted `sort`/`dir` pair from a query string into a safe
 * column + direction. Anything not recognized falls back to the honest
 * default (`completed_at desc` — most recently completed first) rather
 * than erroring — a malformed/malicious param degrades to the default view,
 * it never reaches SQL. */
export function resolveSort(
  sortParam: string | null | undefined,
  dirParam: string | null | undefined,
): { column: CaseloadSortColumn; sql: string; direction: SortDirection } {
  const column: CaseloadSortColumn = isSortColumn(sortParam) ? sortParam : "completed_at";
  const direction: SortDirection = dirParam === "asc" || dirParam === "desc" ? dirParam : DEFAULT_DIRECTION[column];
  return { column, sql: SORT_COLUMN_SQL[column], direction };
}

const DETERMINATION_STATUSES: DeterminationStatus[] = ["draft", "adopted", "contested", "superseded"];
const BANDS = ["SD", "BORDERLINE", "NOT_SD"] as const;

export function isStatusFilter(value: unknown): value is StatusFilter {
  return value === "ALL" || value === "NONE" || (typeof value === "string" && (DETERMINATION_STATUSES as string[]).includes(value));
}

export function isBandFilter(value: unknown): value is BandFilter {
  return value === "ALL" || value === "NONE" || (typeof value === "string" && (BANDS as readonly string[]).includes(value));
}

/** Normalizes an untrusted status filter param; anything unrecognized
 * degrades to "ALL" (no filter), never passed through to SQL as-is. */
export function resolveStatusFilter(value: string | null | undefined): StatusFilter {
  return isStatusFilter(value) ? value : "ALL";
}

export function resolveBandFilter(value: string | null | undefined): BandFilter {
  return isBandFilter(value) ? value : "ALL";
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Only a literal YYYY-MM-DD string is accepted as a date-range bound;
 * anything else (including SQL-shaped strings) is dropped silently rather
 * than interpolated. Still passed as a bound $-parameter in queries.ts, not
 * string-built — this check is defense in depth, not the only guard. */
export function resolveIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return ISO_DATE_RE.test(value) ? value : null;
}

export function resolveSearch(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

export function resolvePage(value: string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  return n;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function resolvePageSize(value: string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

/** Display label for a calculation band — paired with color, never color
 * alone (direction.md "Color and meaning"). */
export function bandLabel(band: "SD" | "BORDERLINE" | "NOT_SD" | null): string {
  if (band === null) return "No calculation";
  if (band === "SD") return "Substantial damage";
  if (band === "BORDERLINE") return "Borderline — requires review";
  return "Not substantial damage";
}

export function determinationStatusLabel(status: DeterminationStatus | null): string {
  if (status === null) return "No determination";
  if (status === "draft") return "Draft";
  if (status === "adopted") return "Adopted";
  if (status === "contested") return "Contested";
  return "Superseded";
}
