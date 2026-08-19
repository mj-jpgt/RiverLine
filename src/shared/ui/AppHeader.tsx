import Link from "next/link";
import { NavLink, type NavLinkItem } from "./NavLink";
import { RoleChip } from "./RoleChip";
import { SignOutButton } from "./SignOutButton";
import { SyncStatusIndicator, type SyncStatusIndicatorProps } from "./SyncStatusIndicator";
import { WaterMotif } from "./WaterMotif";
import styles from "./nav.module.css";

// The persistent, layout-level app shell header (task: "compact header on
// every authenticated page — current section, offline/sync status
// indicator, user email + role chip, sign out"). Pure presentational —
// every piece of live state (which role/session, current pathname, sync
// status) is computed by app/AppShell.tsx and passed in as props, so this
// component has no core/module imports (src/shared/** is a leaf per
// docs/adr/0003-module-boundary-enforcement.md).
export interface AppHeaderProps {
  sectionLabel: string;
  email: string;
  role: string;
  navItems: NavLinkItem[];
  sync: SyncStatusIndicatorProps;
}

export function AppHeader({ sectionLabel, email, role, navItems, sync }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.topRow}>
        <Link href="/home" className={styles.brand}>
          RiverLine SDD
        </Link>
        <span className={styles.section}>{sectionLabel}</span>

        <nav className={styles.nav} aria-label="Primary">
          {navItems.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} active={item.active} />
          ))}
        </nav>

        <div className={styles.identity}>
          <span className={styles.email}>{email}</span>
          <RoleChip role={role} />
          <SignOutButton />
        </div>
      </div>

      {/* Design v2 flood-identity echo (docs/design/direction.md "v2
          amendment" #2) — replaces the header's old flat 1px border-bottom
          with the same restrained water motif used on the landing page, at
          its thin "accent" size. Purely decorative/presentational (no
          hooks, still a server component) and frozen to a static frame
          under prefers-reduced-motion by the global safety net in
          app/globals.css. */}
      <WaterMotif variant="accent" />

      <SyncStatusIndicator
        status={sync.status}
        queuedCount={sync.queuedCount}
        errorMessage={sync.errorMessage}
        onSyncNow={sync.onSyncNow}
      />
    </header>
  );
}
