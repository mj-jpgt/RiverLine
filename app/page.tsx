import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/core/auth";
import { LandingHero } from "./LandingHero";

// The front door. Unauthenticated visitors get a plain, institutional entry
// point (docs/design/direction.md: "an official instrument, not a
// product" — no marketing copy, no product tour, a single Sign in action)
// with the design-v2 flood-instrument identity layered on top (water motif
// + staggered entrance — see LandingHero.tsx, a client island; this page
// stays a server component so the session check + redirect below still run
// server-side, unchanged from v1). A visitor with a valid session is sent
// straight to /home — this page never renders any product content itself.
export default async function LandingPage() {
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (session) {
    redirect("/home");
  }

  return <LandingHero />;
}
