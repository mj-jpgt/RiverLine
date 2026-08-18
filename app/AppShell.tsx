"use client";

// Layout-level persistent app shell (task: "compact header on every
// authenticated page"). Lives beside app/layout.tsx as an app-to-app
// sibling import — the exact same shape app/register-sw.tsx already
// established (a client component mounted from the server RootLayout).
// app-to-app imports are unrestricted under eslint-plugin-boundaries; see
// src/core/determination/queries.ts's own comment and
// docs/journal/2026-08-17-c5-determination.md for the precedent.
//
// This file is the ONLY place in app/ (mine) that reaches into
// src/core/capture for the real offline queue + sync engine
// (getQueuedDrafts / syncAllQueued / registerSyncTriggers) — never
// re-implemented, just reused, same functions app/capture/[id]/CaptureFlow
// .tsx already drives for its own OfflineBanner. src/shared/ui's
// components stay pure presentational leaves; all the live state lives
// here.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getQueuedDrafts, registerSyncTriggers, syncAllQueued } from "@/core/capture";
import { AppHeader, type NavLinkItem, type ShellSyncStatus } from "@/shared/ui";
import type { Role } from "@/core/auth";

export interface ShellSession {
  email: string;
  role: Role;
}

interface AppShellProps {
  session: ShellSession | null;
  children: ReactNode;
}

interface NavItemDef {
  href: string;
  label: string;
  roles: readonly Role[];
}

// Role gating mirrors the same requireRole(...) lists each destination page
// already enforces server-side (app/registry/page.tsx, app/dashboard/
// page.tsx, app/determination/page.tsx) — the nav only ever shows a link a
// role can actually use ("hide," one of the two options the task allows,
// chosen over "disable-with-reason" to keep the header uncluttered for
// assessor/viewer, who have no letters/dashboard/review-queue access at
// all — see journal).
const NAV_ITEMS: NavItemDef[] = [
  { href: "/registry", label: "Find structure", roles: ["admin", "assessor", "official", "viewer"] },
  { href: "/determination", label: "Review queue", roles: ["admin", "official"] },
  { href: "/dashboard", label: "Dashboard", roles: ["admin", "official"] },
  // T-W5: admin-only console (cost tables, jurisdiction settings, readiness).
  { href: "/admin", label: "Administration", roles: ["admin"] },
];

function sectionLabelFor(pathname: string): string {
  if (pathname === "/home") return "Home";
  if (pathname.startsWith("/registry")) return "Structure registry";
  if (pathname.startsWith("/dashboard")) return "Administrator dashboard";
  if (pathname.startsWith("/determination")) return "Determination review";
  if (pathname.startsWith("/calculation")) return "Calculation";
  if (pathname.startsWith("/letters")) return "Determination letter";
  if (pathname.startsWith("/admin")) return "Administration";
  return "RiverLine SDD";
}

export function AppShell({ session, children }: AppShellProps) {
  const pathname = usePathname() ?? "";

  const [online, setOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState(false);

  const refreshQueueCount = useCallback(async () => {
    if (!session) return;
    const queued = await getQueuedDrafts();
    setQueuedCount(queued.length);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    setOnline(navigator.onLine);
    void refreshQueueCount();
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [session, refreshQueueCount]);

  const runSync = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!session) return;
      setSyncing(true);
      setSyncError(null);
      const results = await syncAllQueued(options);
      setSyncing(false);
      await refreshQueueCount();
      // A skipped attempt (still within backoff cooldown, or already
      // in-flight) returns ok:false with no error message — not a real
      // failure to surface. Mirrors the exact same decision
      // CaptureFlow.tsx's runSync() already makes for its own banner.
      const failed = results.find((r) => !r.ok && r.error !== null);
      if (failed) {
        setSyncError(failed.error);
      } else if (results.some((r) => r.ok)) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 2500);
      }
    },
    [session, refreshQueueCount],
  );

  useEffect(() => {
    if (!session) return undefined;
    return registerSyncTriggers(() => void runSync());
  }, [session, runSync]);

  // Capture flow keeps its own full-screen, one-decision-per-screen focus
  // and already ships its own persistent OfflineBanner
  // (app/capture/[id]/_components/OfflineBanner.tsx) — stacking a second
  // shell header + sync strip above it would crowd exactly the surface
  // SUBAGENT.md's field-conditions section protects ("one decision per
  // screen. Large type."), and would show the same queue/sync state twice
  // with two different visual treatments. HIDDEN (not slimmed) on
  // /capture/* — documented decision, see journal.
  const hideShell = pathname.startsWith("/capture");

  if (!session || hideShell) {
    return <>{children}</>;
  }

  const syncStatus: ShellSyncStatus = !online
    ? "offline"
    : syncing
      ? "syncing"
      : syncError || queuedCount > 0
        ? "error"
        : justSynced
          ? "synced"
          : "hidden";

  const navItems: NavLinkItem[] = NAV_ITEMS.filter((item) => item.roles.includes(session.role)).map((item) => ({
    href: item.href,
    label: item.label,
    active: pathname === item.href || pathname.startsWith(`${item.href}/`),
  }));

  return (
    <>
      <AppHeader
        sectionLabel={sectionLabelFor(pathname)}
        email={session.email}
        role={session.role}
        navItems={navItems}
        sync={{
          status: syncStatus,
          queuedCount,
          errorMessage: syncError,
          onSyncNow: () => void runSync({ force: true }),
        }}
      />
      {children}
    </>
  );
}
