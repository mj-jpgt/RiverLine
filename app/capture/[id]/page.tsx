import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getStructureById } from "@/core/registry";
import styles from "./page.module.css";

// Placeholder for T-C3 (field capture, offline-first — src/core/capture/).
// This route exists only so the registry's "Start assessment" button has a
// real destination that isn't a 404 or an unstyled dead end
// (specs/core/tasks.md T-C2 explicitly calls for a "designed placeholder
// page saying capture is T-C3"). It does NOT implement any capture logic —
// no element list, no photo capture, no offline queue. That is out of
// scope for this task.
export default async function CaptureStubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const structure = await getStructureById(guarded.jurisdictionId, guarded.userId, id);

  return (
    <main className={styles.main}>
      <Link href={`/registry/${id}`} className={styles.backLink}>
        ← Back to structure
      </Link>

      <div className={styles.card}>
        <p className={styles.eyebrow}>Field capture — coming soon</p>
        <h1 className={styles.heading}>
          {structure ? structure.address : "Assessment capture"}
        </h1>
        <p className={styles.body}>
          Element-by-element damage capture, photo capture, and offline-first
          autosave for this structure are being built next (RiverLine task
          T-C3). Nothing has been recorded yet — this page is a placeholder,
          not a saved assessment.
        </p>
        <p className={styles.body}>
          When capture ships, this is where an assessor works through the
          FEMA SDE element list, records damage percentages, attaches
          photos, and the device queues everything for sync even with no
          network connection.
        </p>
      </div>
    </main>
  );
}
