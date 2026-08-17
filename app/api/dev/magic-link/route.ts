// Dev-only route: hands back the most recent pending magic-link URL for a
// given email, so local dev / Playwright e2e can complete a real login
// without a mailbox. Hard-gated to non-production, on top of the
// dev-link-store's own gate (defense in depth) — per specs/constitution.md
// §6: "clearly gated to non-production env, never a bypass in production
// code paths."
import { NextResponse } from "next/server";
import { getDevMagicLink } from "@/core/auth";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email query param is required." }, { status: 400 });
  }

  const link = getDevMagicLink(email);
  if (!link) {
    return NextResponse.json({ error: "No pending magic link for that email." }, { status: 404 });
  }

  return NextResponse.json({ url: link.url });
}
