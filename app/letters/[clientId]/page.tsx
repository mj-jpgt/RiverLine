import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getLetterPreview } from "@/modules/a1-letters";
import type { LetterPreviewResult } from "@/modules/a1-letters";
import { OrdinanceForm } from "./_components/OrdinanceForm";
import { IssueLetterAction } from "./_components/IssueLetterAction";
import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";

// A1: determination letters, with an honest, designed refusal state when
// jurisdictions.ordinance_citation is null (specs/constitution.md #2,
// docs/BLOCKERS.md B2 — verified blocked, not solvable by an agent). This
// refusal state is deliberately the most prominent thing this page can
// show: THE TOOL PROPOSES, THE OFFICIAL ADOPTS, and this module refuses to
// fabricate legal citation text under any circumstance (AGENTS.md rule 4).
export default async function LetterPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  let guarded;
  try {
    guarded = requireRole(session, ["admin", "assessor", "official", "viewer"]);
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }

  let preview: LetterPreviewResult;
  try {
    preview = await getLetterPreview(guarded.jurisdictionId, guarded.userId, clientId);
  } catch {
    return (
      <main className={`${styles.main} ${motion.pageEnter}`}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>Determination letter</p>
          <h1 className={styles.heading}>Generate letter</h1>
        </div>
        <div className={styles.errorPanel} role="alert">
          <p className={styles.statePanelText}>
            Could not load the letter for this determination. Try reloading the page.
          </p>
        </div>
      </main>
    );
  }

  const canIssue = guarded.role === "admin" || guarded.role === "official";
  const canEditOrdinance = guarded.role === "admin";

  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>Determination letter</p>
        <h1 className={styles.heading}>Generate letter</h1>
      </div>

      {preview.status === "not_found" ? (
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>No assessment found for this determination.</p>
        </div>
      ) : preview.status === "no_determination" ? (
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>
            This assessment has no adopted determination on record. A letter can only be generated after an official
            adopts a determination.
          </p>
          <Link href={`/determination/${encodeURIComponent(clientId)}`} className={styles.secondaryLink}>
            Go to the review screen
          </Link>
        </div>
      ) : preview.status === "borderline_unresolved" ? (
        <div className={styles.statePanel}>
          <p className={styles.statePanelText}>
            The adopted determination&apos;s calculated ratio is in the borderline range and does not resolve to a
            definite substantial-damage finding. A letter requires a definite SD / NOT_SD result — resolve this
            determination (override an input, or supersede with a corrected calculation) before a letter can be
            generated.
          </p>
          <Link href={`/determination/${encodeURIComponent(clientId)}`} className={styles.secondaryLink}>
            Go to the review screen
          </Link>
        </div>
      ) : preview.status === "citation_missing" ? (
        <div className={styles.refusalPanel} role="alert">
          <p className={styles.refusalHeading}>Letter generation unavailable</p>
          <p className={styles.statePanelText}>
            This jurisdiction&apos;s floodplain ordinance citation has not been entered. See{" "}
            <code className={styles.inlineCode}>docs/BLOCKERS.md</code> B2.
          </p>
          <p className={styles.statePanelText}>
            RiverLine never generates, guesses, or fills in placeholder ordinance text — the citation quoted in a
            determination letter must be the jurisdiction&apos;s own verbatim, human-entered text.
          </p>
          {canEditOrdinance ? (
            <OrdinanceForm clientId={clientId} jurisdictionName={preview.jurisdictionName} />
          ) : (
            <p className={styles.statePanelText}>
              Ask a jurisdiction administrator to enter the ordinance citation before a letter can be generated.
            </p>
          )}
        </div>
      ) : preview.status === "ready" ? (
        <div className={styles.readyPanel}>
          <p className={styles.statePanelText}>
            This determination is adopted and the jurisdiction&apos;s ordinance citation is on file. Review the
            preview below, then issue the letter to create the permanent record.
          </p>
          <div className={styles.previewFrameWrap}>
            <iframe
              title="Letter preview"
              src={`/letters/${encodeURIComponent(clientId)}/print`}
              className={styles.previewFrame}
            />
          </div>
          {canIssue ? (
            <IssueLetterAction clientId={clientId} />
          ) : (
            <p className={styles.statePanelText}>
              Ask an official or administrator to issue this letter.
            </p>
          )}
        </div>
      ) : (
        <div className={styles.readyPanel}>
          <p className={styles.statePanelText}>
            Issued {new Date(preview.issuedAt).toLocaleString("en-US")}.
          </p>
          <div className={styles.previewFrameWrap}>
            <iframe
              title="Issued letter"
              src={`/letters/${encodeURIComponent(clientId)}/print`}
              className={styles.previewFrame}
            />
          </div>
          <a
            href={`/letters/${encodeURIComponent(clientId)}/print`}
            target="_blank"
            rel="noreferrer"
            className={styles.secondaryLink}
          >
            Open in a new tab to print / save as PDF
          </a>
        </div>
      )}
    </main>
  );
}
