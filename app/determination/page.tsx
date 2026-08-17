import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getReviewQueue, filterQueueRows, sortQueueRows } from "@/core/determination";
import type { QueueStatusFilter, ReviewQueueRow } from "@/core/determination";
import styles from "./page.module.css";

// M4 official review queue (T-C5) — official/admin roles only (role guard
// from T-C1). "All completed assessments with calculations, sorted
// BORDERLINE first, then SD, then NOT_SD, then drafts/no-calculation"
// (task instructions) — getReviewQueue's SQL already sorts this way;
// sortQueueRows re-applies the same pure comparator so the ordering is
// provably the same rule the unit tests cover, not just "whatever SQL
// happened to return."

const FILTERS: { value: QueueStatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "BORDERLINE", label: "Borderline" },
  { value: "SD", label: "Substantial damage" },
  { value: "NOT_SD", label: "Not substantial damage" },
  { value: "DRAFT_NO_CALC", label: "No calculation yet" },
];

function isStatusFilter(value: string | undefined): value is QueueStatusFilter {
  return value !== undefined && FILTERS.some((f) => f.value === value);
}

function statusBadgeClass(row: ReviewQueueRow): string {
  if (row.thresholdResult === null) return styles.statusBadgeDraft as string;
  if (row.thresholdResult === "NOT_SD") return styles.statusBadgeNotSd as string;
  if (row.thresholdResult === "BORDERLINE") return styles.statusBadgeBorderline as string;
  return styles.statusBadgeSd as string;
}

function statusLabel(row: ReviewQueueRow): string {
  if (row.thresholdResult === null) return "No calculation yet";
  if (row.thresholdResult === "NOT_SD") return "Not substantial damage";
  if (row.thresholdResult === "BORDERLINE") return "Borderline — requires review";
  return "Substantial damage";
}

function determinationChip(row: ReviewQueueRow): string | null {
  if (row.determinationStatus === "adopted") return "Adopted";
  if (row.determinationStatus === "superseded") return "Superseded";
  if (row.determinationStatus === "contested") return "Contested";
  return null;
}

export default async function DeterminationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "official"]);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }

  const activeFilter: QueueStatusFilter = isStatusFilter(status) ? status : "ALL";

  let rows: ReviewQueueRow[] = [];
  let loadError: string | null = null;
  try {
    const all = await getReviewQueue(guarded.jurisdictionId, guarded.userId);
    rows = filterQueueRows(sortQueueRows(all), activeFilter);
  } catch {
    loadError = "Could not load the review queue. Try reloading the page.";
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Official review</p>
        <h1 className={styles.heading}>Determination queue</h1>
        <p className={styles.subhead}>
          Completed assessments awaiting review, sorted so the closest calls — borderline ratios — surface first.
        </p>
      </div>

      <div className={styles.filterRow} role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "ALL" ? "/determination" : `/determination?status=${f.value}`}
            className={activeFilter === f.value ? styles.filterButtonActive : styles.filterButton}
            aria-current={activeFilter === f.value ? "true" : undefined}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {loadError ? (
        <div className={styles.errorPanel} role="alert">
          <p className={styles.statePanelText}>{loadError}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>
            {activeFilter === "ALL"
              ? "No assessments awaiting review. Completed assessments will appear here once an assessor finishes and syncs one."
              : "No assessments match this filter right now."}
          </p>
        </div>
      ) : (
        <ul className={styles.queueList}>
          {rows.map((row) => (
            <li key={row.assessmentId} className={styles.queueItem}>
              <Link href={`/determination/${encodeURIComponent(row.clientId)}`} className={styles.queueLink}>
                <div className={styles.queueMain}>
                  <span className={styles.queueAddress}>{row.address}</span>
                  <span className={styles.queueMeta}>
                    Completed {new Date(row.completedAt).toLocaleDateString("en-US")}
                    {row.calculationCount > 1 ? ` · ${row.calculationCount} calculations on file` : ""}
                  </span>
                </div>
                <div className={styles.queueBadges}>
                  <span className={statusBadgeClass(row)}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {statusLabel(row)}
                    {row.ratio !== null ? (
                      <span className={styles.ratioInline}>{(row.ratio * 100).toFixed(1)}%</span>
                    ) : null}
                  </span>
                  {determinationChip(row) ? (
                    <span className={styles.determinationChip}>{determinationChip(row)}</span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
