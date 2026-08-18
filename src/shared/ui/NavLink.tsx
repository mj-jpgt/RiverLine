import Link from "next/link";
import styles from "./nav.module.css";

// Presentational only — "active" is computed by the caller (app/AppShell.tsx
// knows the current pathname) so this component stays a pure leaf with no
// core/module imports (eslint-plugin-boundaries: src/shared/** is a leaf,
// docs/adr/0003-module-boundary-enforcement.md).
export interface NavLinkItem {
  href: string;
  label: string;
  active: boolean;
}

export function NavLink({ href, label, active }: NavLinkItem) {
  return (
    <Link
      href={href}
      className={active ? styles.navLinkActive : styles.navLink}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}
