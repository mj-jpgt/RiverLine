import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getStructureById } from "@/core/registry";
import { CaptureFlow } from "./CaptureFlow";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

// M2 field capture, offline-first (T-C3). Replaces the T-C2 placeholder.
// Server component only handles auth + the initial structure fetch (for
// prefill and the "not found" state) — every screen after that runs
// entirely client-side against IndexedDB (src/core/capture/), per AGENTS.md
// "Offline is a requirement, not a feature": capture logic never lives in
// server calls/actions/route handlers, only the final sync POST does.
export default async function CapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "assessor", "official"]);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }

  const structure = await getStructureById(guarded.jurisdictionId, guarded.userId, id);
  if (!structure) {
    notFound();
  }

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <Link href={`/registry/${id}`} className={styles.backLink}>
        ← Back to structure
      </Link>
      <CaptureFlow structureId={id} jurisdictionId={guarded.jurisdictionId} structure={structure} />
    </main>
  );
}
