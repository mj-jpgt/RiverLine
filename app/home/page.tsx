import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { PoolClient } from "pg";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getReviewQueue } from "@/core/determination";
import { isNonEmptyOrdinanceCitation } from "@/modules/a1-letters";
import { withTenant } from "@/shared/db";
import { QueuedAssessments } from "./QueuedAssessments";
import styles from "./page.module.css";

// Role-aware launchpad (T-W1). Replaces the T-C1 generic "session plumbing
// works" placeholder — that proof now lives in the persistent shell header
// (app/AppShell.tsx: email + role chip + Log out are there on every
// authenticated page, not duplicated here). This page keeps exactly one
// "Welcome, {email}" heading and defers the role text to the header so
// test/e2e/login.spec.ts's single-match assertions
// (getByText("assessor", {exact:true}), getByRole("button",{name:"Log
// out"})) still resolve to exactly one element each.
//
// "Jurisdiction settings" (task instructions: "Admin additionally: link if
// such page exists") was checked and does not exist anywhere in app/ —
// not built here, per the instruction to not invent one.

async function isOrdinanceOnFile(jurisdictionId: string, userId: string | null): Promise<boolean> {
  return withTenant(jurisdictionId, userId, async (client: PoolClient) => {
    const { rows } = await client.query(`select ordinance_citation from jurisdictions where id = $1`, [
      jurisdictionId,
    ]);
    const citation = (rows[0]?.ordinance_citation as string | null | undefined) ?? null;
    return isNonEmptyOrdinanceCitation(citation);
  });
}

interface OfficialSummary {
  pendingCount: number;
  borderlineCount: number;
  ordinanceOnFile: boolean;
}

const AWAITING_REVIEW = new Set<string | null>([null, "draft"]);

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "assessor", "official", "viewer"]);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }

  const isOfficialOrAdmin = guarded.role === "official" || guarded.role === "admin";

  let summary: OfficialSummary | null = null;
  let summaryError: string | null = null;
  if (isOfficialOrAdmin) {
    try {
      const [queue, ordinanceOnFile] = await Promise.all([
        getReviewQueue(guarded.jurisdictionId, guarded.userId),
        isOrdinanceOnFile(guarded.jurisdictionId, guarded.userId),
      ]);
      // "Awaiting review" = a completed assessment with no determination
      // yet, or one still in draft — the same real, human-facing state
      // app/determination's own queue page renders per row, aggregated
      // into a count here rather than re-derived by a different rule.
      const pendingCount = queue.filter((r) => AWAITING_REVIEW.has(r.determinationStatus)).length;
      const borderlineCount = queue.filter(
        (r) => r.thresholdResult === "BORDERLINE" && AWAITING_REVIEW.has(r.determinationStatus),
      ).length;
      summary = { pendingCount, borderlineCount, ordinanceOnFile };
    } catch {
      summaryError = "Could not load review-queue status. Try reloading the page.";
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Signed in</p>
        <h1 className={styles.heading}>Welcome, {guarded.email}</h1>
      </div>

      {guarded.role === "assessor" ? (
        <>
          <section className={styles.section} aria-label="Field assessment">
            <h2 className={styles.sectionHeading}>Field assessment</h2>
            <p className={styles.sectionSubhead}>
              Find a structure to start or resume a damage assessment.
            </p>
            <Link href="/registry" className={styles.primaryLink}>
              <span>Find structure</span>
              <span className={styles.primaryLinkHint}>Search by address or nearby</span>
            </Link>
          </section>

          <section className={styles.section} aria-label="Queued assessments">
            <h2 className={styles.sectionHeading}>My queued assessments</h2>
            <p className={styles.sectionSubhead}>
              Completed on this device, waiting to sync.
            </p>
            <QueuedAssessments />
          </section>
        </>
      ) : null}

      {isOfficialOrAdmin ? (
        <>
          <section className={styles.section} aria-label="Determination review">
            <h2 className={styles.sectionHeading}>Determination review</h2>
            {summaryError ? (
              <div className={styles.errorPanel} role="alert">
                <p className={styles.statePanelText}>{summaryError}</p>
              </div>
            ) : summary ? (
              <>
                <div className={styles.statsRow}>
                  <div className={styles.statTile}>
                    <span className={styles.statCount}>{summary.pendingCount}</span>
                    <span className={styles.statLabel}>Awaiting review</span>
                  </div>
                  <div className={`${styles.statTile} ${styles.statTileBorderline}`}>
                    <span className={styles.statCount}>{summary.borderlineCount}</span>
                    <span className={styles.statLabel}>Borderline — requires review</span>
                  </div>
                </div>
                <Link href="/determination" className={styles.secondaryLink}>
                  <span className={styles.secondaryLinkLabel}>Determination queue</span>
                  <span className={styles.secondaryLinkMeta}>Review, override, adopt</span>
                </Link>
              </>
            ) : null}
          </section>

          <section className={styles.section} aria-label="Jurisdiction dashboard">
            <h2 className={styles.sectionHeading}>Jurisdiction dashboard</h2>
            <Link href="/dashboard" className={styles.secondaryLink}>
              <span className={styles.secondaryLinkLabel}>Administrator dashboard</span>
              <span className={styles.secondaryLinkMeta}>Caseload, filters, CSV export</span>
            </Link>
          </section>

          <section className={styles.section} aria-label="Determination letters">
            <h2 className={styles.sectionHeading}>Determination letters</h2>
            {summary ? (
              summary.ordinanceOnFile ? (
                <div className={styles.configChipOk}>
                  <span className={styles.configDot} aria-hidden="true" />
                  <span>
                    Ordinance citation on file — letters can be issued from an
                    adopted determination.
                  </span>
                </div>
              ) : (
                <div className={styles.configChipMissing}>
                  <span className={styles.configDot} aria-hidden="true" />
                  <span>
                    Ordinance citation missing — letters blocked. Set it from
                    any adopted determination&apos;s letter page.
                  </span>
                </div>
              )
            ) : null}
          </section>
        </>
      ) : null}

      {guarded.role === "viewer" ? (
        <section className={styles.section} aria-label="Structure lookup">
          <h2 className={styles.sectionHeading}>Structure lookup</h2>
          <p className={styles.sectionSubhead}>View-only access to the structure registry.</p>
          <Link href="/registry" className={styles.primaryLink}>
            <span>Find structure</span>
            <span className={styles.primaryLinkHint}>Search by address or nearby</span>
          </Link>
        </section>
      ) : null}
    </main>
  );
}
