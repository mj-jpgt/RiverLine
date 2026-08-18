import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionCookie, requireRole, AuthError } from "@/core/auth";
import { withTenant } from "@/shared/db";
import { getStorageDriver } from "@/shared/storage";

// Serves a photo's bytes for the review screen's thumbnail + click-to-full
// views (task requirement: "photos (thumbnails, click to full)"). Reads
// photos.storage_key (jurisdiction-scoped by RLS — a cross-tenant id never
// resolves a row here) and streams the bytes back through this server (never
// a public/signed bucket URL — see docs/adr/0008-object-storage.md "why
// serving stays an authenticated proxy") from wherever T-C3's sync route
// wrote them (src/shared/storage's StorageDriver — local filesystem or
// Supabase Storage, per STORAGE_DRIVER).

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
