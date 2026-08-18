import styles from "./nav.module.css";

// Posts to the real, already-existing /api/auth/logout route (app/api/auth/
// logout/route.ts) — not a new auth code path, just the one persistent
// place in the shell that reaches it now that app/home/page.tsx's old
// inline form has been consolidated into the header (see docs/journal
// entry for this task: exactly one "Log out" control must exist per page,
// both for the UI itself and because test/e2e/login.spec.ts's
// getByRole("button", { name: "Log out" }) is a strict-mode query — two
// matching buttons on one page would fail it).
export function SignOutButton() {
  return (
    <form method="POST" action="/api/auth/logout" className={styles.signOutForm}>
      <button type="submit" className={styles.signOutButton}>
        Log out
      </button>
    </form>
  );
}
