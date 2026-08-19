import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { filterQueueRows } from "@/core/determination";
import type { QueueStatusFilter, ReviewQueueRow } from "@/core/determination";
import { getTriageQueue, getExposureRollup, sortTriageQueue } from "@/core/intelligence";
import type { TriageQueueRow } from "@/core/intelligence";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

// M4 official review queue (T-C5) — official/admin roles only (role guard
// from T-C1). "All completed assessments with calculations, sorted
// BORDERLINE first, then SD, then NOT_SD, then drafts/no-calculation"
// (task instructions) — getReviewQueue's SQL already sorts this way;
// sortTriageQueue (src/core/intelligence, G4) re-applies that SAME bucket
// order as its primary key and only adds a priority-score tiebreak WITHIN
// each bucket, replacing the prior "oldest completed_at first" tiebreak —
// see the "Why this order?" disclosure below for the formula, shown in
// plain language, and docs/data-contracts/depth-damage-review.md for why
// this module computes a queue-ordering SCORE and never a per-element
// damage suggestion.

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
  if (row.thresholdResult === "BORDERLINE") return "Borderline, requires review";
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

  let rows: TriageQueueRow[] = [];
  let exposureExposureTotal: number | null = null;
  let exposureCount = 0;
  let loadError: string | null = null;
  try {
    const [allTriage, exposure] = await Promise.all([
      getTriageQueue(guarded.jurisdictionId, guarded.userId),
      getExposureRollup(guarded.jurisdictionId, guarded.userId),
    ]);
    const filteredRows = filterQueueRows(
      allTriage.map((t) => t.row),
      activeFilter,
    );
    const scores = new Map(allTriage.map((t) => [t.row.assessmentId, t.score]));
    rows = sortTriageQueue(filteredRows, scores);
    exposureExposureTotal = exposure.unreviewedExposureTotal;
    exposureCount = exposure.unreviewedCount;
  } catch {
    loadError = "Could not load the review queue. Try reloading the page.";
  }

  const usd = (n: number | null) =>
    n === null ? "N/A" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Official review</p>
        <h1 className={styles.heading}>Determination queue</h1>
        <p className={styles.subhead}>
          Completed assessments awaiting review, sorted so the closest calls, borderline ratios, surface first.
        </p>
      </div>

      {/* --- Exposure rollup (G4): the repair-cost money sitting in the
          queue right now — every assessment with a calculation but no
          adopted (or contested) determination yet. Computed live, never
          persisted (src/core/intelligence getExposureRollup). --- */}
      <section className={styles.exposureRow} aria-label="Unreviewed exposure">
        <div className={styles.exposureStat}>
          <span className={styles.exposureLabel}>Unreviewed assessments</span>
          <span className={styles.exposureValue}>{exposureCount.toLocaleString("en-US")}</span>
        </div>
        <div className={styles.exposureStat}>
          <span className={styles.exposureLabel}>Computed repair cost awaiting review</span>
          <span className={styles.exposureValue}>{usd(exposureExposureTotal)}</span>
        </div>
      </section>

      {/* --- Priority ordering explanation (G4): the exact formula, in
          plain language, per task instructions — never an opaque score. --- */}
      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>Why this order?</summary>
        <div className={styles.disclosureBody}>
          <p>
            Assessments are grouped first by band: borderline, then substantial damage, then not substantial
            damage, then no calculation yet. That grouping never changes. Within a band, a priority score orders
            the closest calls first:
          </p>
          <ul className={styles.disclosureList}>
            <li>40%: how close the ratio is to the 50% legal line</li>
            <li>30%: improvement value at stake (higher value scores higher, relative to others waiting today)</li>
            <li>20%: recorded interior water depth (deeper scores higher, relative to others waiting today)</li>
            <li>10%: flood zone severity (coastal high-hazard V zones highest, inland A zones next, other/unknown lowest)</li>
          </ul>
          <p>Ties fall back to whichever assessment has been waiting longest. Nothing here changes the calculation itself. It only orders the queue.</p>
        </div>
      </details>

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
          {rows.map(({ row, score }) => (
            <li key={row.assessmentId} className={styles.queueItem}>
              <Link href={`/determination/${encodeURIComponent(row.clientId)}`} className={styles.queueLink}>
                <div className={styles.queueMain}>
                  <span className={styles.queueAddress}>{row.address}</span>
                  <span className={styles.queueMeta}>
                    Completed {new Date(row.completedAt).toLocaleDateString("en-US")}
                    {row.calculationCount > 1 ? ` · ${row.calculationCount} calculations on file` : ""}
                    {" · "}
                    <span className={styles.priorityInline}>Priority {Math.round(score.total * 100)}</span>
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
