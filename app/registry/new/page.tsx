import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { ManualStructureForm } from "./ManualStructureForm";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

// "Structure not found?" path (F1 registry task, coverage gap): the county
// ingest only covers a subset of Hamilton County's 153,883 parcels (see
// docs/journal/2026-08-18-f1-registry.md "Coverage"). When a flooded
// structure is not in that loaded set, an assessor can add a minimal record
// by hand from here instead of being stuck. Viewer role cannot create
// (matches app/capture/[id]/page.tsx's role gate — read-only role never
// writes data).
export default async function NewStructurePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    requireRole(session, ["admin", "assessor", "official"]);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <Link href="/registry" className={styles.backLink}>
        ← Back to search
      </Link>

      <div className={styles.header}>
        <p className={styles.eyebrow}>Structure registry</p>
        <h1 className={styles.heading}>Add a structure by hand</h1>
        <p className={styles.subhead}>
          Use this when a flooded address is not in the county parcel records loaded in this app.
          Only the address is required.
        </p>
      </div>

      <p className={styles.warningBanner}>
        This creates an unverified record. It will be clearly marked as hand-entered everywhere it
        appears, and it has no county-assessed value until an official adds one.
      </p>

      <ManualStructureForm initialAddress={address ?? ""} />
    </main>
  );
}
