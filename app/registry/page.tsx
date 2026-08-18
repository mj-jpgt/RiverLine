import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { RegistrySearch } from "./RegistrySearch";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

// M1 structure registry landing page: address search + "near me". Real
// data only — no hardcoded rows; RegistrySearch (client) talks to
// /api/registry/search and /api/registry/near, both tenant-scoped via
// withTenant()/RLS.
export default async function RegistryPage() {
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
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Structure registry</p>
        <h1 className={styles.heading}>Find a structure</h1>
        <p className={styles.subhead}>
          Search by address, or use your current location to find the closest
          structures on record.
        </p>
      </div>
      <RegistrySearch />
    </main>
  );
}
