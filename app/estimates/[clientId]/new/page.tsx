import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { EstimateUploadFlow } from "./EstimateUploadFlow";
import motion from "@/shared/ui/motion.module.css";
import styles from "../../page.module.css";

// Upload + client-side OCR step. Runs entirely client-side
// (docs/adr/0007-ocr-estimate-intake.md) — this server component only
// gates auth and hands off to the client flow, same shape every other
// module uses (app/capture/[id]/page.tsx pattern).
export default async function NewEstimatePage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    requireRole(session, ["admin", "assessor", "official"]);
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <Link href={`/estimates/${encodeURIComponent(clientId)}`} className={styles.backLink}>
        ← Back to estimates
      </Link>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Contractor estimates</p>
        <h1 className={styles.heading}>Attach a document</h1>
        <p className={styles.subhead}>
          Photograph or select a contractor repair estimate. Text is read automatically to pre-fill the next
          screen — nothing is saved as a final value until you review and confirm it.
        </p>
      </div>
      <EstimateUploadFlow clientId={clientId} />
    </main>
  );
}
