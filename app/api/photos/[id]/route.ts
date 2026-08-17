import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { withTenant } from "@/shared/db";

// Serves a photo's bytes for the review screen's thumbnail + click-to-full
// views (task requirement: "photos (thumbnails, click to full)"). Reads
// photos.storage_key (jurisdiction-scoped by RLS — a cross-tenant id never
// resolves a row here) and streams the file T-C3's sync route wrote under
// uploads/<jurisdictionId>/<sha256>.jpg. No route existed to read photos
// back before this task; capture (T-C3) only ever wrote them.
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  try {
    const { jurisdictionId, userId } = requireRole(session, ["admin", "assessor", "official", "viewer"]);

    const storageKey = await withTenant(jurisdictionId, userId, async (client) => {
      const res = await client.query(`select storage_key from photos where id = $1`, [id]);
      return (res.rows[0]?.storage_key as string | undefined) ?? null;
    });

    if (!storageKey) {
      return new Response("Not found", { status: 404 });
    }

    // storage_key is content-addressed (jurisdictionId/sha256.jpg), written
    // only by app/api/capture/sync/route.ts — never derived from unsanitized
    // user input, so a direct path.join is safe here.
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
