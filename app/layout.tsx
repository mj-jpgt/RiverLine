import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";
import { AppShell, type ShellSession } from "./AppShell";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/core/auth";

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
    <html lang="en">
      <body>
        <RegisterServiceWorker />
        <AppShell session={shellSession}>{children}</AppShell>
      </body>
    </html>
  );
}
