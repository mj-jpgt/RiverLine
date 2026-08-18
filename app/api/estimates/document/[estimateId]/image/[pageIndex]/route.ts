import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { resolveEstimatePageStorageKey } from "@/modules/a4-estimates";

// Serves one page of an estimate document's bytes for the confirmation UI
// (side-by-side image + crop overlay, spec §8 mitigation 1) and the
// read-only estimates list. Same shape as app/api/photos/[id]/route.ts —
// jurisdiction-scoped via the module's withTenant query, reads the
// uploads/<jurisdictionId>/estimates/<sha256>.jpg path
// src/modules/a4-estimates/actions.ts's createEstimateVersion writes.
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ estimateId: string; pageIndex: string }> },
) {
  const { estimateId, pageIndex } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official", "viewer"]);

    const index = Number(pageIndex);
    if (!Number.isInteger(index) || index < 0) {
      return new Response("Not found", { status: 404 });
    }

    const storageKey = await resolveEstimatePageStorageKey(jurisdictionId, userId, estimateId, index);
    if (!storageKey) {
      return new Response("Not found", { status: 404 });
    }

    // storage_key is content-addressed (jurisdictionId/estimates/sha256.jpg),
    // written only by src/modules/a4-estimates/actions.ts — never derived
    // from unsanitized user input, so a direct path.join is safe here (same
    // pattern app/api/photos/[id]/route.ts already uses).
    const filePath = path.join(UPLOADS_ROOT, storageKey);
    const bytes = await readFile(filePath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(err.message, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
    }
    return new Response("Not found", { status: 404 });
  }
}
