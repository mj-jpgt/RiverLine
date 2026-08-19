import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireActiveRole, AuthError } from "@/core/auth";
import { getReadinessStatus } from "@/core/admin";
import styles from "./shared.module.css";

// T-W5 admin console landing screen: the honest readiness panel. This is
// the page that tells a new jurisdiction exactly what it must do to make
// the tool work — every row is read straight off the real tables the
// calculation engine (app/calculation/_lib/compute.ts) and the letters
// module (src/modules/a1-letters) actually check, never a separately
// tracked "setup complete" flag.
export default async function AdminPage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    // G3: requireActiveRole (not requireRole) — a deactivated admin's
    // signed session cookie can still verify (sessions are stateless), so
    // this is the request-time DB check that refuses it anyway.
    guarded = await requireActiveRole(session, ["admin"]);
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  let readiness;
  let loadError: string | null = null;
  try {
    readiness = await getReadinessStatus(guarded.jurisdictionId, guarded.userId);
  } catch {
    loadError = "Could not load readiness status. Try reloading the page.";
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Administration</p>
        <h1 className={styles.heading}>Jurisdiction readiness</h1>
        <p className={styles.subhead}>
          What this jurisdiction has configured, and what still blocks assessments, calculations, and letters.
        </p>
      </div>

      {loadError ? (
        <div className={styles.errorPanel} role="alert">
          <p className={styles.statePanelText}>{loadError}</p>
        </div>
      ) : readiness ? (
        <div className={styles.readinessGrid}>
          <div className={readiness.costTableLoaded ? styles.readinessRow : styles.readinessRowNotSet}>
            <div className={styles.readinessMain}>
              <p className={styles.readinessLabel}>Cost table</p>
              {readiness.costTableLoaded ? (
                <span className={styles.statusBadgeOk}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  OK, active version {readiness.activeCostTableVersion}
                </span>
              ) : (
                <>
                  <span className={styles.statusBadgeNotSet}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    NOT SET
                  </span>
                  <p className={styles.readinessBlockedText}>
                    Calculations cannot run. Every assessment will show &quot;no cost table loaded&quot; until a
                    table is loaded here. See docs/BLOCKERS.md B1.
                  </p>
                </>
              )}
            </div>
            <Link href="/admin/cost-tables" className={styles.secondaryButton}>
              {readiness.costTableLoaded ? "Manage cost tables" : "Load a cost table"}
            </Link>
          </div>

          <div className={readiness.ordinanceCitationSet ? styles.readinessRow : styles.readinessRowNotSet}>
            <div className={styles.readinessMain}>
              <p className={styles.readinessLabel}>Ordinance citation</p>
              {readiness.ordinanceCitationSet ? (
                <span className={styles.statusBadgeOk}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  OK, on file
                </span>
              ) : (
                <>
                  <span className={styles.statusBadgeNotSet}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    NOT SET
                  </span>
                  <p className={styles.readinessBlockedText}>
                    Letters cannot be issued. Determination letters refuse to generate until the
                    jurisdiction&apos;s ordinance citation is entered here. See docs/BLOCKERS.md B2.
                  </p>
                </>
              )}
            </div>
            <Link href="/admin/jurisdiction" className={styles.secondaryButton}>
              {readiness.ordinanceCitationSet ? "Edit jurisdiction settings" : "Set ordinance citation"}
            </Link>
          </div>

          <div className={readiness.appealWindowSet ? styles.readinessRow : styles.readinessRowNotSet}>
            <div className={styles.readinessMain}>
              <p className={styles.readinessLabel}>Appeal window</p>
              {readiness.appealWindowSet ? (
                <span className={styles.statusBadgeOk}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  OK, configured
                </span>
              ) : (
                <>
                  <span className={styles.statusBadgeNotSet}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    NOT SET
                  </span>
                  <p className={styles.readinessBlockedText}>
                    Letters will omit an appeal deadline. appeal_deadline_date stays unset on every determination
                    until an appeal window (in days) is configured here.
                  </p>
                </>
              )}
            </div>
            <Link href="/admin/jurisdiction" className={styles.secondaryButton}>
              {readiness.appealWindowSet ? "Edit jurisdiction settings" : "Set appeal window"}
            </Link>
          </div>

          <div className={styles.readinessRow}>
            <div className={styles.readinessMain}>
              <p className={styles.readinessLabel}>Team</p>
              <span className={styles.statusBadgeOk}>
                <span className={styles.statusDot} aria-hidden="true" />
                {`${readiness.team.activeTotal} active user${readiness.team.activeTotal === 1 ? "" : "s"} (${readiness.team.activeAssessors} assessor${readiness.team.activeAssessors === 1 ? "" : "s"}, ${readiness.team.activeOfficials} official${readiness.team.activeOfficials === 1 ? "" : "s"})`}
              </span>
            </div>
            <Link href="/admin/users" className={styles.secondaryButton}>
              Manage team
            </Link>
          </div>
        </div>
      ) : null}
    </main>
  );
}
