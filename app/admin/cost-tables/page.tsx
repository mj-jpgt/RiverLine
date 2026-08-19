import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getCostTables } from "@/core/admin";
import { CostTableForm } from "./_components/CostTableForm";
import styles from "../shared.module.css";

// T-W5: cost-table management. The critical piece — this is the only place
// in the codebase a real user (not a test harness) can ever INSERT a
// cost_tables row, which is what makes the 50%-rule engine runnable at all
// (previously: docs/BLOCKERS.md B1, "no cost table loaded" forever).
export default async function CostTablesPage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin"]);
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  let costTables;
  let loadError: string | null = null;
  try {
    costTables = await getCostTables(guarded.jurisdictionId, guarded.userId);
  } catch {
    loadError = "Could not load cost tables. Try reloading the page.";
  }

  return (
    <main className={styles.mainWide}>
      <Link href="/admin" className={styles.backLink}>
        &larr; Back to readiness
      </Link>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Administration</p>
        <h1 className={styles.heading}>Cost tables</h1>
        <p className={styles.subhead}>
          Every calculation stamps the cost table version it used, so a contested determination stays reproducible.
          Loading a new table never deletes or edits an existing one. It inserts a new version.
        </p>
      </div>

      <section className={styles.section} aria-label="Existing cost tables">
        <h2 className={styles.sectionHeading}>On file</h2>
        {loadError ? (
          <div className={styles.errorPanel} role="alert">
            <p className={styles.statePanelText}>{loadError}</p>
          </div>
        ) : !costTables || costTables.length === 0 ? (
          <div className={styles.statePanel}>
            <p className={styles.statePanelText}>
              No cost table loaded yet. Every assessment will show &quot;no cost table loaded&quot; (see
              docs/BLOCKERS.md B1) until one is loaded below.
            </p>
          </div>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.th}>
                    Version
                  </th>
                  <th scope="col" className={styles.th}>
                    Active
                  </th>
                  <th scope="col" className={styles.th}>
                    Scope
                  </th>
                  <th scope="col" className={styles.th}>
                    Source citation
                  </th>
                  <th scope="col" className={styles.th}>
                    Effective date
                  </th>
                  <th scope="col" className={styles.th}>
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {costTables.map((row) => (
                  <tr key={row.version}>
                    <td className={styles.td}>{row.version}</td>
                    <td className={styles.td}>
                      {row.isActive ? (
                        <span className={styles.statusBadgeOk}>
                          <span className={styles.statusDot} aria-hidden="true" />
                          ACTIVE
                        </span>
                      ) : (
                        <span className={styles.statusBadgeMuted}>
                          <span className={styles.statusDot} aria-hidden="true" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className={styles.td}>{row.jurisdictionId ? "This jurisdiction" : "Shared / global"}</td>
                    <td className={styles.td}>{row.sourceCitation}</td>
                    <td className={styles.tdNum}>{row.effectiveDateIso}</td>
                    <td className={styles.tdNum}>{row.createdAtIso.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.formHint}>
          ACTIVE = the row a real calculation would use right now: this jurisdiction&apos;s own table if one exists,
          otherwise the shared/global table, preferring the most recent effective date within that preference
          (matches app/calculation/_lib/compute.ts&apos;s selection exactly).
        </p>
      </section>

      <section className={styles.section} aria-label="Load a cost table">
        <h2 className={styles.sectionHeading}>Load a cost table</h2>
        <CostTableForm />
      </section>
    </main>
  );
}
