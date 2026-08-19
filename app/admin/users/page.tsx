import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireActiveRole, AuthError } from "@/core/auth";
import { listUsers } from "@/core/admin";
import { AddUserForm } from "./_components/AddUserForm";
import { UsersTable } from "./_components/UsersTable";
import styles from "../shared.module.css";

// T-G3: team user management — THE GAP this task closes. Before this
// screen existed, the only way to create a users row anywhere in this
// codebase was a seed script; an emergency manager had no way to onboard
// an inspector. Admin-only, tenant-scoped (src/core/admin/queries.ts
// listUsers filters on jurisdiction_id via withTenant/RLS).
//
// requireActiveRole (not requireRole): a deactivated admin's own session
// cookie can still be cryptographically valid (sessions are stateless,
// src/core/auth/session.ts) — this is the request-time DB check
// (migrations/0007_users_deactivated.sql users.deactivated_at) that
// refuses it anyway.
export default async function UsersPage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = await requireActiveRole(session, ["admin"]);
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  let users;
  let loadError: string | null = null;
  try {
    users = await listUsers(guarded.jurisdictionId, guarded.userId);
  } catch {
    loadError = "Could not load team members. Try reloading the page.";
  }

  return (
    <main className={styles.mainWide}>
      <Link href="/admin" className={styles.backLink}>
        &larr; Back to readiness
      </Link>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Administration</p>
        <h1 className={styles.heading}>Team</h1>
        <p className={styles.subhead}>
          Add the people who need to sign in to this jurisdiction, choose what each of them can do, and turn off
          access for anyone who leaves. Adding someone here makes them eligible to sign in immediately.
        </p>
      </div>

      <section className={styles.section} aria-label="Current team">
        <h2 className={styles.sectionHeading}>Current team</h2>
        {loadError ? (
          <div className={styles.errorPanel} role="alert">
            <p className={styles.statePanelText}>{loadError}</p>
          </div>
        ) : (
          <UsersTable users={users ?? []} currentUserId={guarded.userId} />
        )}
      </section>

      <section className={styles.section} aria-label="Add a team member">
        <h2 className={styles.sectionHeading}>Add a team member</h2>
        <AddUserForm />
      </section>
    </main>
  );
}
