import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";
import { AppShell, type ShellSession } from "./AppShell";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/core/auth";
import { EnableTouchActiveStates } from "@/shared/ui";

// Design v2 (docs/design/direction.md "v2 amendment" #3): Public Sans (UI —
// USWDS's own current typeface, keeps the institutional register) + IBM
// Plex Mono (data/tabular figures), loaded via next/font/google so both are
// self-hosted at build time (no runtime request to fonts.googleapis.com,
// same offline-safety property the project already relies on for every
// other asset) and get font-display: swap automatically. Weights 400-700
// only — direction.md → "Type": "No thin or light weights anywhere — they
// disappear in sunlight." Each font's generated CSS variable is consumed by
// docs/design/tokens.css's --font-ui/--font-data (the only place a
// font-family is ever referenced by a component) — see the citation there.
const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-public-sans",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "RiverLine SDD",
  description:
    "Field tool for local floodplain officials to record flood damage and compute the FEMA 50% substantial-damage ratio.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Field tool is used one-handed outdoors; user-controlled zoom stays on.
  themeColor: "#0b1b2b",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Soft session read only — NOT a role guard/redirect. Every protected page
  // still does its own requireRole(...) + redirect("/login") (unchanged);
  // this is purely so the persistent shell (app/AppShell.tsx) knows whether
  // to render its header, and with which email/role, on the unauthenticated
  // pages ("/", "/login") this same layout also wraps.
  const cookieStore = await cookies();
  const session = verifySessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  const shellSession: ShellSession | null = session ? { email: session.email, role: session.role } : null;

  return (
    <html lang="en" className={`${publicSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <RegisterServiceWorker />
        <EnableTouchActiveStates />
        <AppShell session={shellSession}>{children}</AppShell>
      </body>
    </html>
  );
}
