import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { getLetterPreview, readArchivedLetterHtml, renderLetterHtml } from "@/modules/a1-letters";

// Serves the print-first standalone HTML letter document (docs/adr/0006-letter-rendering.md).
// If the letter has already been issued, serves the ARCHIVED copy read back
// from disk byte-for-byte (the permanent record). If not yet issued,
// renders a live PREVIEW from the current adopted-determination facts (the
// underlying facts do not change after adoption, so the two are identical
// except for the screen-only preview banner). Refuses (plain text, no HTML
// leaked) for every other state — never renders a letter for anything but
// an adopted, definite, cited determination.
export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official", "viewer"]);

    const preview = await getLetterPreview(jurisdictionId, userId, clientId);

    if (preview.status === "issued") {
      const html = await readArchivedLetterHtml(preview.storageKey);
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (preview.status === "ready") {
      const html = renderLetterHtml(preview.facts, { issued: false });
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("No letter is available for this determination.", { status: 404 });
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(err.message, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    console.error("[letters] print failed:", err);
    return new Response("Could not render the letter.", { status: 500 });
  }
}
