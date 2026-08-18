import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { EstimatesSearch } from "./EstimatesSearch";
import styles from "./page.module.css";

// A4 contractor-estimate intake — module entry point. This is this
// module's OWN discoverability page: it is not linked from
// app/determination/ (out of this task's assigned directory — see the
// journal's "integration point for a follow-up" note) or anywhere else yet,
// so an assessor/official finds an assessment here directly, the same way
// app/registry/page.tsx is the entry point for M1.
export default async function EstimatesIndexPage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    requireRole(session, ["admin", "assessor", "official", "viewer"]);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Contractor estimates</p>
        <h1 className={styles.heading}>Find an assessment</h1>
        <p className={styles.subhead}>
          Attach a contractor repair estimate to a completed assessment. This is
          reference data for the official&apos;s review — value and cost overrides in
          the determination flow remain the mechanism of record.
        </p>
      </div>
      <EstimatesSearch />
    </main>
  );
}
