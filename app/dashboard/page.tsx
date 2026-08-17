import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import {
  getDashboardCounts,
  getCaseload,
  resolveStatusFilter,
  resolveBandFilter,
  resolveIsoDate,
  resolveSearch,
  resolvePage,
  resolvePageSize,
  resolveSort,
  bandLabel,
  determinationStatusLabel,
} from "@/modules/a2-dashboard";
import type { CaseloadSortColumn, SortDirection, BandFilter, StatusFilter } from "@/modules/a2-dashboard";
import { ExportCsvButton, FullExportButton } from "./_components/ExportButtons";
import styles from "./page.module.css";

// A2 administrator dashboard (T-A2): status overview (by determination
// status AND by calculation band, task instructions) + the caseload table
// (all structures, sortable/filterable/paginated, server-side — 3,821 rows
// is not something to ship to the client in one payload) + CSV export.
// Desktop-first responsive, official/admin roles only (same role guard as
// app/determination). No map in this pass — see "Open item" note at bottom
// of the journal entry; MapLibre is not installed and the spec makes the
// map optional (build spec §2.1 confines it to this add-on, never a capture
// dependency).

type RawParams = Record<string, string | string[] | undefined>;

function one(params: RawParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

const BAND_FILTERS: { value: BandFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SD", label: "Substantial damage" },
  { value: "BORDERLINE", label: "Borderline" },
  { value: "NOT_SD", label: "Not substantial damage" },
  { value: "NONE", label: "No calculation" },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "adopted", label: "Adopted" },
  { value: "contested", label: "Contested" },
  { value: "superseded", label: "Superseded" },
  { value: "NONE", label: "No determination" },
];

const SORT_LABELS: { value: CaseloadSortColumn; label: string }[] = [
  { value: "address", label: "Address" },
  { value: "ratio", label: "Ratio" },
  { value: "band", label: "Band" },
  { value: "status", label: "Determination" },
  { value: "completed_at", label: "Completed" },
];

function bandBadgeClass(band: "SD" | "BORDERLINE" | "NOT_SD" | null): string {
  if (band === null) return styles.statusBadgeDraft as string;
  if (band === "NOT_SD") return styles.statusBadgeNotSd as string;
  if (band === "BORDERLINE") return styles.statusBadgeBorderline as string;
  return styles.statusBadgeSd as string;
}

function statusBadgeClass(status: string | null): string {
  if (status === "adopted") return styles.statusBadgeNotSd as string;
  if (status === "contested") return styles.statusBadgeSd as string;
  if (status === "draft") return styles.statusBadgeBorderline as string;
  return styles.statusBadgeDraft as string; // superseded / none
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const raw = await searchParams;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "official"]);
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  const filters = {
    search: resolveSearch(one(raw, "search")),
    status: resolveStatusFilter(one(raw, "status")),
    band: resolveBandFilter(one(raw, "band")),
    dateFrom: resolveIsoDate(one(raw, "dateFrom")),
    dateTo: resolveIsoDate(one(raw, "dateTo")),
  };
  const { column: sortColumn, direction } = resolveSort(one(raw, "sort"), one(raw, "dir"));
  const page = resolvePage(one(raw, "page"));
  const pageSize = resolvePageSize(one(raw, "pageSize"));

  function hrefWith(overrides: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = {
      search: filters.search,
      status: filters.status === "ALL" ? null : filters.status,
      band: filters.band === "ALL" ? null : filters.band,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      sort: sortColumn,
      dir: direction,
      page: String(page),
      ...overrides,
    };
    for (const [k, v] of Object.entries(current)) {
      if (v !== null && v !== "") params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/dashboard?${qs}` : "/dashboard";
  }

  function exportQueryString(): string {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.status !== "ALL") params.set("status", filters.status);
    if (filters.band !== "ALL") params.set("band", filters.band);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    params.set("sort", sortColumn);
    params.set("dir", direction);
    return params.toString();
  }

  let counts;
  let caseload;
  let loadError: string | null = null;
  try {
    [counts, caseload] = await Promise.all([
      getDashboardCounts(guarded.jurisdictionId, guarded.userId),
      getCaseload(guarded.jurisdictionId, guarded.userId, filters, sortColumn, direction, page, pageSize),
    ]);
  } catch {
    loadError = "Could not load the dashboard. Try reloading the page.";
  }

  const totalPages = caseload ? Math.max(1, Math.ceil(caseload.totalCount / caseload.pageSize)) : 1;

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Administrator dashboard</p>
        <h1 className={styles.heading}>Jurisdiction caseload</h1>
        <p className={styles.subhead}>
          Every structure on record, its latest assessment, calculation, and determination state.
        </p>
      </div>

      {loadError ? (
        <div className={styles.errorPanel} role="alert">
          <p className={styles.statePanelText}>{loadError}</p>
        </div>
      ) : (
        <>
          {/* --- Status overview: text-forward stat rows, never icon cards
              or left-border-strip cards (docs/design/components.md §4.2). --- */}
          <section className={styles.statsGrid} aria-label="Status overview">
            <div className={styles.statsGroup}>
              <h2 className={styles.statsGroupHeading}>By determination status</h2>
              <dl className={styles.statsList}>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeDraft}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Draft
                  </dt>
                  <dd className={styles.statCount}>{counts!.byDeterminationStatus.draft}</dd>
                </div>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeNotSd}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Adopted
                  </dt>
                  <dd className={styles.statCount}>{counts!.byDeterminationStatus.adopted}</dd>
                </div>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeSd}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Contested
                  </dt>
                  <dd className={styles.statCount}>{counts!.byDeterminationStatus.contested}</dd>
                </div>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeDraft}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Superseded
                  </dt>
                  <dd className={styles.statCount}>{counts!.byDeterminationStatus.superseded}</dd>
                </div>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeMuted}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    No determination
                  </dt>
                  <dd className={styles.statCount}>{counts!.byDeterminationStatus.none}</dd>
                </div>
              </dl>
            </div>

            <div className={styles.statsGroup}>
              <h2 className={styles.statsGroupHeading}>By calculation band</h2>
              <dl className={styles.statsList}>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeSd}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Substantial damage
                  </dt>
                  <dd className={styles.statCount}>{counts!.byCalculationBand.SD}</dd>
                </div>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeBorderline}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Borderline
                  </dt>
                  <dd className={styles.statCount}>{counts!.byCalculationBand.BORDERLINE}</dd>
                </div>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeNotSd}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Not substantial damage
                  </dt>
                  <dd className={styles.statCount}>{counts!.byCalculationBand.NOT_SD}</dd>
                </div>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeMuted}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    No calculation
                  </dt>
                  <dd className={styles.statCount}>{counts!.byCalculationBand.noCalculation}</dd>
                </div>
              </dl>
            </div>

            <div className={styles.statsGroup}>
              <h2 className={styles.statsGroupHeading}>Total</h2>
              <dl className={styles.statsList}>
                <div className={styles.statsRow}>
                  <dt className={styles.statusBadgeMuted}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    Structures on record
                  </dt>
                  <dd className={styles.statCount}>{counts!.totalStructures}</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* --- Export --- */}
          <div className={styles.exportRow}>
            <ExportCsvButton queryString={exportQueryString()} />
            <FullExportButton />
          </div>

          {/* --- Filters --- */}
          <section className={styles.filtersSection} aria-label="Filter caseload">
            <div className={styles.filterGroup}>
              <span className={styles.filterGroupLabel}>Band</span>
              <div className={styles.filterRow} role="group" aria-label="Filter by calculation band">
                {BAND_FILTERS.map((f) => (
                  <Link
                    key={f.value}
                    href={hrefWith({ band: f.value === "ALL" ? null : f.value, page: "1" })}
                    className={filters.band === f.value ? styles.filterButtonActive : styles.filterButton}
                    aria-current={filters.band === f.value ? "true" : undefined}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className={styles.filterGroup}>
              <span className={styles.filterGroupLabel}>Determination status</span>
              <div className={styles.filterRow} role="group" aria-label="Filter by determination status">
                {STATUS_FILTERS.map((f) => (
                  <Link
                    key={f.value}
                    href={hrefWith({ status: f.value === "ALL" ? null : f.value, page: "1" })}
                    className={filters.status === f.value ? styles.filterButtonActive : styles.filterButton}
                    aria-current={filters.status === f.value ? "true" : undefined}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            </div>

            <form method="get" action="/dashboard" className={styles.searchForm}>
              <input type="hidden" name="status" value={filters.status === "ALL" ? "" : filters.status} />
              <input type="hidden" name="band" value={filters.band === "ALL" ? "" : filters.band} />
              <input type="hidden" name="sort" value={sortColumn} />
              <input type="hidden" name="dir" value={direction} />

              <label className={styles.fieldLabel} htmlFor="search">
                Search address
              </label>
              <input
                id="search"
                name="search"
                type="text"
                defaultValue={filters.search ?? ""}
                placeholder="123 Practice Ln"
                className={styles.textInput}
              />

              <label className={styles.fieldLabel} htmlFor="dateFrom">
                Completed from
              </label>
              <input
                id="dateFrom"
                name="dateFrom"
                type="date"
                defaultValue={filters.dateFrom ?? ""}
                className={styles.dateInput}
              />

              <label className={styles.fieldLabel} htmlFor="dateTo">
                Completed to
              </label>
              <input
                id="dateTo"
                name="dateTo"
                type="date"
                defaultValue={filters.dateTo ?? ""}
                className={styles.dateInput}
              />

              <button type="submit" className={styles.filterButtonActive}>
                Apply filters
              </button>
              <Link href="/dashboard" className={styles.filterButton}>
                Clear filters
              </Link>
            </form>
          </section>

          {/* --- Caseload table --- */}
          {!caseload || caseload.rows.length === 0 ? (
            <div className={styles.statePanel}>
              <p className={styles.statePanelText}>
                {filters.search || filters.status !== "ALL" || filters.band !== "ALL" || filters.dateFrom || filters.dateTo
                  ? "No structures match this filter."
                  : "No structures on record yet. They will appear here once the registry is loaded."}
              </p>
            </div>
          ) : (
            <>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {SORT_LABELS.map((s) => {
                        const active = sortColumn === s.value;
                        const nextDir: SortDirection = active && direction === "asc" ? "desc" : "asc";
                        return (
                          <th key={s.value} scope="col" className={styles.th}>
                            <Link
                              href={hrefWith({ sort: s.value, dir: nextDir, page: "1" })}
                              className={styles.thLink}
                              aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
                            >
                              {s.label}
                              {active ? (direction === "asc" ? " ▲" : " ▼") : ""}
                            </Link>
                          </th>
                        );
                      })}
                      <th scope="col" className={styles.th}>
                        Parcel ID
                      </th>
                      <th scope="col" className={styles.th}>
                        Value used
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {caseload.rows.map((row) => (
                      <tr key={row.structureId}>
                        <td className={styles.td}>{row.address}</td>
                        <td className={styles.tdNum}>{row.ratio === null ? "—" : `${(row.ratio * 100).toFixed(1)}%`}</td>
                        <td className={styles.td}>
                          <span className={bandBadgeClass(row.band)}>
                            <span className={styles.statusDot} aria-hidden="true" />
                            {bandLabel(row.band)}
                          </span>
                        </td>
                        <td className={styles.td}>
                          <span className={statusBadgeClass(row.determinationStatus)}>
                            <span className={styles.statusDot} aria-hidden="true" />
                            {determinationStatusLabel(row.determinationStatus)}
                          </span>
                        </td>
                        <td className={styles.tdNum}>
                          {row.completedAt ? new Date(row.completedAt).toLocaleDateString("en-US") : "—"}
                        </td>
                        <td className={styles.td}>{row.parcelId}</td>
                        <td className={styles.tdNum}>
                          {row.marketValueUsed === null
                            ? "—"
                            : row.marketValueUsed.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.paginationRow}>
                <p className={styles.paginationMeta}>
                  Page {caseload.page} of {totalPages} · {caseload.totalCount.toLocaleString("en-US")} structures
                </p>
                <div className={styles.paginationButtons}>
                  <Link
                    href={hrefWith({ page: String(Math.max(1, page - 1)) })}
                    className={page <= 1 ? styles.filterButtonDisabled : styles.filterButton}
                    aria-disabled={page <= 1}
                  >
                    Previous
                  </Link>
                  <Link
                    href={hrefWith({ page: String(Math.min(totalPages, page + 1)) })}
                    className={page >= totalPages ? styles.filterButtonDisabled : styles.filterButton}
                    aria-disabled={page >= totalPages}
                  >
                    Next
                  </Link>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
