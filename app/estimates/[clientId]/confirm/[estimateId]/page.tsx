import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getAssessmentEstimatesContext, getEstimateDetail } from "@/modules/a4-estimates";
import { ConfirmEstimateForm } from "./ConfirmEstimateForm";
import motion from "@/shared/ui/motion.module.css";
import styles from "../../../page.module.css";

// The confirmation screen — spec §8's central UI. Server-loads the
// already-uploaded, already-persisted estimate (so an assessor can resume
// this exact step later; the upload itself already happened in
// app/estimates/[clientId]/new) and hands raw data to the client
// confirmation form, which is the only place any confirmed_* value is ever
// produced.
export default async function ConfirmEstimatePage({
  params,
}: {
  params: Promise<{ clientId: string; estimateId: string }>;
}) {
  const { clientId, estimateId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let jurisdictionId: string;
  let userId: string | null;
  try {
    const s = requireRole(session, ["admin", "assessor", "official"]);
    jurisdictionId = s.jurisdictionId;
    userId = s.userId;
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  const [context, detail] = await Promise.all([
    getAssessmentEstimatesContext(jurisdictionId, userId, clientId),
    getEstimateDetail(jurisdictionId, userId, estimateId),
  ]);
  if (!context || !detail || detail.assessmentId !== context.assessmentId) notFound();

  if (detail.isConfirmed) {
    return (
      <main className={`${styles.main} ${motion.pageEnter}`}>
        <Link href={`/estimates/${encodeURIComponent(clientId)}`} className={styles.backLink}>
          ← Back to estimates
        </Link>
        <div className={styles.header}>
          <h1 className={styles.heading}>Already confirmed</h1>
        </div>
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>
            Version {detail.version} of this estimate was already confirmed on{" "}
            {detail.confirmedAtIso ? new Date(detail.confirmedAtIso).toLocaleDateString() : "an earlier date"}. To
            correct a value, attach a new version instead.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <Link href={`/estimates/${encodeURIComponent(clientId)}`} className={styles.backLink}>
        ← Back to estimates
      </Link>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Contractor estimates — version {detail.version}</p>
        <h1 className={styles.heading}>Review and confirm</h1>
        <p className={styles.subhead}>
          Nothing here is saved as a final value until you confirm it. Verify each amount against the source
          document, tap the row that is the correct total, and confirm the scope before saving.
        </p>
      </div>
      <ConfirmEstimateForm
        clientId={clientId}
        estimateId={estimateId}
        pages={detail.pages}
        extracted={detail.extracted}
        structureImprovementValue={context.structureImprovementValue}
      />
    </main>
  );
}
