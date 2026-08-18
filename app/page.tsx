import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/core/auth";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

// The front door. Unauthenticated visitors get a plain, institutional entry
// point (docs/design/direction.md: "an official instrument, not a
// product" — no marketing copy, no product tour, a single Sign in action).
// A visitor with a valid session is sent straight to /home — this page
// never renders any product content itself.
export default async function LandingPage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (session) {
    redirect("/home");
  }

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <div className={styles.card}>
        {/* h1 is the literal product name — test/e2e/smoke.spec.ts asserts
            getByRole("heading", { name: "RiverLine SDD" }) on this route,
            and Playwright's role-name matching is substring/case-
            insensitive by default, so this must be the heading text itself,
            not just visible text elsewhere on the page. */}
        <h1 className={styles.heading}>RiverLine SDD</h1>
        <p className={styles.eyebrow}>Substantial-damage determination instrument</p>
        <p className={styles.lede}>
          A field record and calculation instrument for local floodplain
          officials: document flood damage, compute the FEMA 50%
          substantial-damage ratio, and issue the resulting determination.
        </p>

        <ul className={styles.factList}>
          <li className={styles.factItem}>
            <span className={styles.factLabel}>Used by</span>
            <span>Jurisdiction assessors and floodplain officials</span>
          </li>
          <li className={styles.factItem}>
            <span className={styles.factLabel}>Decision-maker</span>
            <span>The local official — this tool proposes, it never adopts</span>
          </li>
          <li className={styles.factItem}>
            <span className={styles.factLabel}>Access</span>
            <span>Jurisdiction-issued accounts only — no self-signup</span>
          </li>
        </ul>

        <Link href="/login" className={styles.signInButton}>
          Sign in
        </Link>

        <p className={styles.footNote}>
          Determinations issued through this tool carry legal consequences
          under your jurisdiction&apos;s floodplain management ordinance.
        </p>
      </div>
    </main>
  );
}
