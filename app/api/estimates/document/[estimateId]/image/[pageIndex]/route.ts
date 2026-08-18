import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { resolveEstimatePageStorageKey } from "@/modules/a4-estimates";
import { getStorageDriver } from "@/shared/storage";

// Serves one page of an estimate document's bytes for the confirmation UI
// (side-by-side image + crop overlay, spec §8 mitigation 1) and the
// read-only estimates list. Same shape as app/api/photos/[id]/route.ts —
// jurisdiction-scoped via the module's withTenant query, reads back through
// src/shared/storage's StorageDriver whatever
// src/modules/a4-estimates/actions.ts's createEstimateVersion wrote.

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

    const { bytes, contentType } = await getStorageDriver().get(storageKey);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
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
