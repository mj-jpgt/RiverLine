import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getReviewDetail, listAuditLogForAssessment, groupPhotosByElement } from "@/core/determination";
import type { ReviewDetail } from "@/core/determination";
import { elementsForOccupancy } from "@/core/capture";
import { OverrideElementControl } from "./_components/OverrideElementControl";
import { OverrideValueControl } from "./_components/OverrideValueControl";
import { AdoptAction } from "./_components/AdoptAction";
import { SupersedeAction } from "./_components/SupersedeAction";
import { PhotoPanel } from "./_components/PhotoPanel";
import motion from "@/shared/ui/motion.module.css";
import styles from "./review.module.css";

// M4 official review screen (T-C5): every input visible, per-element and
// value overrides (audited, reason mandatory), explicit adopt with
// confirmation, read-only + supersede once adopted. THE TOOL PROPOSES, THE
// OFFICIAL ADOPTS — nothing on this page can set status='adopted' without
// the explicit AdoptAction confirm step.

const VALUE_SOURCE_LABELS: Record<string, string> = {
  assessed_improvement: "Assessed improvement value",
  assessed_total: "Assessed total value (land + improvements)",
  assessed_adjusted: "Assessed value, adjusted",
  appraisal: "Independent appraisal",
  official_override: "Set by official override",
};

const WATER_DEPTH_SOURCE_LABELS: Record<string, string> = {
  observed_line: "Observed water line",
  measured: "Measured",
  owner_reported: "Owner reported",
  modeled: "Modeled",
  unknown: "Unknown",
};

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

const STATUS_LABEL: Record<ReviewDetail["thresholdResult"], string> = {
  NOT_SD: "Not substantial damage",
  BORDERLINE: "Borderline",
  SD: "Substantial damage",
};

function statusClass(threshold: ReviewDetail["thresholdResult"]): string {
  switch (threshold) {
    case "NOT_SD":
      return styles.statusBadgeNotSd as string;
    case "BORDERLINE":
      return styles.statusBadgeBorderline as string;
    case "SD":
      return styles.statusBadgeSd as string;
  }
}

function AuditHistory({ entries }: { entries: Awaited<ReturnType<typeof listAuditLogForAssessment>> }) {
  if (entries.length === 0) return null;
  return (
    <section className={styles.card} aria-label="Audit history">
      <h2 className={styles.cardHeading}>History</h2>
      <ul className={styles.auditList}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.auditItem}>
            <span className={styles.auditAction}>{entry.action.replace(/_/g, " ")}</span>
            <span className={styles.auditMeta}>
              {entry.actorEmail ?? "system"} · {new Date(entry.at).toLocaleString("en-US")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function DeterminationReviewPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
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

  const result = await getReviewDetail(guarded.jurisdictionId, guarded.userId, clientId);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "no_calculation") {
    return (
      <main className={`${styles.main} ${motion.pageEnter}`}>
        <Link href="/determination" className={styles.backLink}>
          ← Back to queue
        </Link>
        <div className={styles.header}>
          <p className={styles.eyebrow}>Official review</p>
          <h1 className={styles.heading}>{result.address}</h1>
        </div>
        <div className={styles.blockedPanel} role="status">
          <h2 className={styles.blockedHeading}>No calculation on file yet</h2>
          <p className={styles.blockedText}>
            This assessment has no calculation to review — either the cost table isn&apos;t loaded for this
            jurisdiction (see <span className={styles.blockedCode}>docs/BLOCKERS.md B1</span>) or structure attributes
            are incomplete. Nothing is lost; review this once a calculation exists.
          </p>
        </div>
      </main>
    );
  }

  const detail = result.detail;
  const isAdopted = detail.determination?.status === "adopted";
  const isSuperseded = detail.determination?.status === "superseded";
  const auditEntries = await listAuditLogForAssessment(guarded.jurisdictionId, guarded.userId, detail.assessmentId);
  const valueSourceLabel = VALUE_SOURCE_LABELS[detail.valueSource] ?? detail.valueSource;

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <Link href="/determination" className={styles.backLink}>
        ← Back to queue
      </Link>

      <div className={styles.header}>
        <p className={styles.eyebrow}>Official review</p>
        <h1 className={styles.heading}>{detail.address}</h1>
      </div>

      {isAdopted ? (
        <div className={styles.adoptedBanner} role="status">
          <p className={styles.adoptedBannerText}>
            Adopted by {detail.determination?.adoptedByEmail ?? "unknown"} on{" "}
            {detail.determination?.adoptedAt ? new Date(detail.determination.adoptedAt).toLocaleString("en-US") : ""}.
            This is the official finding of record — read-only. Use Supersede to issue a corrected determination.
          </p>
        </div>
      ) : null}
      {isSuperseded ? (
        <div className={styles.blockedPanel} role="status">
          <p className={styles.blockedText}>
            This determination has been superseded. See the review queue for the current draft.
          </p>
        </div>
      ) : null}

      {detail.priorCalculationCount > 0 ? (
        <p className={styles.historyNote}>
          This is calculation #{detail.priorCalculationCount + 1} for this assessment — recalculated after an
          override. Earlier calculations remain on file (calculations are never edited or deleted, AGENTS.md rule
          10); see History below.
        </p>
      ) : null}

      <section className={styles.resultCard} aria-label="Calculation result">
        <p className={styles.ratioValue}>{formatPercent(detail.ratio)}</p>
        <p className={styles.ratioLabel}>Damage-to-value ratio</p>
        <span className={statusClass(detail.thresholdResult)}>
          <span className={styles.statusDot} aria-hidden="true" />
          {STATUS_LABEL[detail.thresholdResult]}
        </span>
        <p className={styles.legalLine}>The regulatory substantial damage threshold is 50% of market value.</p>
        {detail.thresholdResult === "BORDERLINE" ? (
          <p className={styles.borderlineNote}>Within calculation tolerance — requires official review.</p>
        ) : null}
      </section>

      <section className={styles.card} aria-label="Calculation inputs">
        <h2 className={styles.cardHeading}>Inputs used</h2>
        <dl className={styles.grid}>
          <div>
            <dt className={styles.dt}>Total repair cost</dt>
            <dd className={styles.ddMono}>{formatCurrency(detail.totalRepairCost)}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Market value used</dt>
            <dd className={styles.ddMono}>{formatCurrency(detail.marketValueUsed)}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Cost table version</dt>
            <dd className={styles.ddMono}>{detail.costTableVersion}</dd>
          </div>
          <div>
            <dt className={styles.dt}>Engine version</dt>
            <dd className={styles.ddMono}>{detail.engineVersion}</dd>
          </div>
          <div>
            <dt className={styles.dt}>GPS</dt>
            <dd className={styles.ddMono}>
              {detail.gpsLat !== null && detail.gpsLng !== null
                ? `${detail.gpsLat.toFixed(5)}, ${detail.gpsLng.toFixed(5)}`
                : "Not recorded"}
              {detail.gpsAccuracyM !== null ? ` (±${detail.gpsAccuracyM.toFixed(0)}m)` : ""}
            </dd>
          </div>
          <div>
            <dt className={styles.dt}>Water depth</dt>
            <dd className={styles.dd}>
              {detail.waterDepthInteriorIn !== null ? `${detail.waterDepthInteriorIn}″ interior` : "Not recorded"}
              {detail.waterDepthSource ? ` — ${WATER_DEPTH_SOURCE_LABELS[detail.waterDepthSource] ?? detail.waterDepthSource}` : ""}
            </dd>
          </div>
        </dl>
        <p className={styles.sourceNote}>
          Value source: {valueSourceLabel}
          {detail.costTableSourceCitation ? (
            <>
              <br />
              Cost table source: {detail.costTableSourceCitation}
            </>
          ) : null}
          <br />
          Computed {new Date(detail.computedAt).toLocaleString("en-US")}
        </p>
        {detail.notes ? <p className={styles.sourceNote}>Assessor notes: {detail.notes}</p> : null}
        <OverrideValueControl clientId={clientId} currentValue={detail.marketValueUsed} disabled={isAdopted || isSuperseded} />
      </section>

      <section className={styles.card} aria-label="Photos">
        <h2 className={styles.cardHeading}>Photos</h2>
        {detail.photos.length === 0 ? (
          <p className={styles.noPhotoNote}>No photos on file for this assessment — flagged, not hidden.</p>
        ) : (
          groupPhotosByElement(detail.photos, elementsForOccupancy(detail.occupancyType)).map((group) => (
            <div key={group.code} className={styles.photoGroup}>
              <h3 className={styles.photoGroupHeading}>{group.heading}</h3>
              <PhotoPanel photos={group.photos} emptyLabel="No photos on file for this assessment — flagged, not hidden." />
            </div>
          ))
        )}
      </section>

      <section className={styles.card} aria-label="Per-element breakdown">
        <h2 className={styles.cardHeading}>Per-element breakdown</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Element</th>
                <th scope="col" className={styles.numCell}>
                  Damage %
                </th>
                <th scope="col" className={styles.numCell}>
                  Repair cost
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.elements.map((el) => (
                <tr key={el.elementCode}>
                  <td>
                    <div>{el.elementName}</div>
                    <OverrideElementControl
                      clientId={clientId}
                      elementCode={el.elementCode}
                      elementName={el.elementName}
                      currentDamagePct={el.damagePct}
                      disabled={isAdopted || isSuperseded}
                    />
                  </td>
                  <td className={styles.numCell}>{el.damagePct}%</td>
                  <td className={styles.numCell}>{formatCurrency(el.computedCost)}</td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td>Total</td>
                <td />
                <td className={styles.numCell}>{formatCurrency(detail.totalRepairCost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <AuditHistory entries={auditEntries} />

      <section className={styles.card} aria-label="Determination">
        <h2 className={styles.cardHeading}>Determination</h2>
        {isAdopted && detail.determination ? (
          <>
            <dl className={styles.grid}>
              <div>
                <dt className={styles.dt}>Appeal deadline</dt>
                <dd className={styles.dd}>{detail.determination.appealDeadlineDate ?? "Not set"}</dd>
              </div>
            </dl>
            {detail.determination.appealDeadlineDate === null ? (
              <div className={styles.blockedPanel} role="status">
                <p className={styles.blockedText}>
                  Appeal window not configured for this jurisdiction — see{" "}
                  <span className={styles.blockedCode}>docs/BLOCKERS.md B2</span> (ordinance). The determination is
                  adopted; the appeal deadline field is left blank rather than an invented number of days.
                </p>
              </div>
            ) : null}
            <div className={styles.actions}>
              <SupersedeAction determinationId={detail.determination.id} />
            </div>
          </>
        ) : isSuperseded ? null : (
          <AdoptAction clientId={clientId} />
        )}
      </section>
    </main>
  );
}
