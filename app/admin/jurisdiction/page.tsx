import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getJurisdictionSettings } from "@/core/admin";
import { JurisdictionSettingsForm } from "./_components/JurisdictionSettingsForm";
import styles from "../shared.module.css";

// T-W5: jurisdiction settings — ordinance citation, appeal window,
// letterhead. Parallel to app/letters/[clientId]/ordinance/route.ts's
// bolted-on citation form (which is left untouched); this is the fuller
// standalone admin screen the task asked for (letterhead name/address/ICC
// had no UI anywhere before this).
export default async function JurisdictionSettingsPage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin"]);
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  let settings;
  let loadError: string | null = null;
  try {
    settings = await getJurisdictionSettings(guarded.jurisdictionId, guarded.userId);
  } catch {
    loadError = "Could not load jurisdiction settings. Try reloading the page.";
  }

  return (
    <main className={styles.mainWide}>
      <Link href="/admin" className={styles.backLink}>
        &larr; Back to readiness
      </Link>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Administration</p>
        <h1 className={styles.heading}>{settings ? settings.jurisdictionName : "Jurisdiction"} settings</h1>
        <p className={styles.subhead}>
          Ordinance citation, appeal window, and letterhead. Used by every determination letter.
        </p>
      </div>

      {loadError || !settings ? (
        <div className={styles.errorPanel} role="alert">
          <p className={styles.statePanelText}>{loadError ?? "Jurisdiction not found."}</p>
        </div>
      ) : (
        <section className={styles.section} aria-label="Jurisdiction settings">
          <JurisdictionSettingsForm initial={settings} />
        </section>
      )}
    </main>
  );
}
