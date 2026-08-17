import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import styles from "./page.module.css";

// The generic authenticated landing page — this is what T-C1's login e2e
// spec lands on, and what protected-route redirect is tested against.
// Real module landing pages (dashboard, review queue, capture flow) belong
// to their own tasks (T-A2, T-C5, T-C3); this page only proves the session
// + role-guard plumbing works end to end.
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

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Signed in</p>
        <h1 className={styles.heading}>Welcome, {guarded.email}</h1>
        <dl className={styles.meta}>
          <div>
            <dt>Role</dt>
            <dd>{guarded.role}</dd>
          </div>
          <div>
            <dt>Jurisdiction</dt>
            <dd className={styles.mono}>{guarded.jurisdictionId}</dd>
          </div>
        </dl>
        <form method="POST" action="/api/auth/logout">
          <button type="submit" className={styles.logoutButton}>
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}
