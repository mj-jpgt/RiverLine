import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getAssessmentEstimatesContext } from "@/modules/a4-estimates";
import styles from "../page.module.css";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function formatDate(iso: string | null): string {
  if (!iso) return "date unknown";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// A4 estimates list for one assessment (build task requirement: "estimates
// list per assessment... showing version chain, confirmed totals with
// provenance labels, and the document images"). REFERENCE DATA ONLY — the
// copy below says so explicitly, and nothing here writes to
// determinations/calculations; value/cost overrides in the determination
// flow (app/determination/, out of this task's module directory) remain
// the mechanism of record.
export default async function AssessmentEstimatesPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let jurisdictionId: string;
  let userId: string | null;
  try {
    const s = requireRole(session, ["admin", "assessor", "official", "viewer"]);
    jurisdictionId = s.jurisdictionId;
    userId = s.userId;
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  const context = await getAssessmentEstimatesContext(jurisdictionId, userId, clientId);
  if (!context) notFound();

  return (
    <main className={styles.main}>
      <Link href="/estimates" className={styles.backLink}>
        ← Back to search
      </Link>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Contractor estimates</p>
        <h1 className={styles.heading}>{context.structureAddress}</h1>
        <p className={styles.subhead}>
          {context.versions.length === 0
            ? "No estimates attached yet."
            : `${context.versions.length} version${context.versions.length === 1 ? "" : "s"} on file.`}
        </p>
      </div>

      {context.versions.length === 0 ? (
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>
            No contractor estimate has been attached to this assessment yet. Attach one to pre-fill candidate line
            items and a total for the official to reference — OCR extraction is optional and every value still
            requires human confirmation before it is stored.
          </p>
        </div>
      ) : (
        context.versions.map((v, i) => {
          const isSuperseded = i > 0;
          return (
            <div key={v.id} className={styles.card}>
              <div className={styles.cardHeadRow}>
                <p className={styles.versionLabel}>
                  Version {v.version}
                  {isSuperseded ? <span className={styles.supersededTag}> — superseded</span> : null}
                </p>
                {v.isConfirmed ? (
                  <span className={v.provenance === "ocr_assisted" ? styles.provenanceOcr : styles.provenanceManual}>
                    {v.provenance === "ocr_assisted" ? "OCR-assisted, human-confirmed" : "Manual entry"}
                  </span>
                ) : (
                  <span className={styles.provenancePending}>Awaiting confirmation</span>
                )}
              </div>

              {v.confirmedTotal !== null ? (
                <p className={styles.totalValue}>{formatCurrency(v.confirmedTotal)}</p>
              ) : (
                <p className={styles.metaLine}>Not yet confirmed — no total on record.</p>
              )}

              <p className={styles.metaLine}>Uploaded {formatDate(v.createdAtIso)}</p>
              {v.originalFilename ? <p className={styles.metaLine}>File: {v.originalFilename}</p> : null}
              {v.confirmedByEmail ? (
                <p className={styles.metaLine}>
                  Confirmed by {v.confirmedByEmail} on {formatDate(v.confirmedAtIso)}
                </p>
              ) : null}

              {v.sanityFlag ? (
                <p className={styles.sanityWarning}>
                  This total exceeds 3× the structure&apos;s assessed improvement value — flagged for manual review.
                </p>
              ) : null}

              <div className={styles.pageThumbRow}>
                {Array.from({ length: v.pageCount }).map((_, pageIndex) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={pageIndex}
                    src={`/api/estimates/document/${v.id}/image/${pageIndex}`}
                    alt={`Estimate document page ${pageIndex + 1}`}
                    className={styles.pageThumb}
                  />
                ))}
              </div>

              {!v.isConfirmed ? (
                <Link href={`/estimates/${encodeURIComponent(clientId)}/confirm/${v.id}`} className={styles.confirmLink}>
                  Review and confirm
                </Link>
              ) : null}
            </div>
          );
        })
      )}

      <Link href={`/estimates/${encodeURIComponent(clientId)}/new`} className={styles.newEstimateLink}>
        {context.versions.length === 0 ? "Attach a contractor estimate" : "Attach a new version"}
      </Link>

      <p className={styles.referenceNote}>
        These estimates are reference data for the official&apos;s review. They do not change the calculated repair
        cost or ratio — an official records a value or cost override directly in the determination review screen if
        a contractor estimate changes their finding.
      </p>
    </main>
  );
}
