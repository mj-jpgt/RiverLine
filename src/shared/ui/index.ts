// Public entry point for src/shared/ui — shared, presentational nav
// components for the persistent app shell (T-W1). src/shared/** is a leaf
// element under eslint-plugin-boundaries (docs/adr/0003-module-boundary-
// enforcement.md): nothing here imports src/core/* or src/modules/* — all
// live data (session, sync/offline state, current route) is computed in
// app/AppShell.tsx and passed down as props.
export { AppHeader } from "./AppHeader";
export type { AppHeaderProps } from "./AppHeader";
export { NavLink } from "./NavLink";
export type { NavLinkItem } from "./NavLink";
export { RoleChip } from "./RoleChip";
export { SignOutButton } from "./SignOutButton";
export { SyncStatusIndicator } from "./SyncStatusIndicator";
export type { ShellSyncStatus, SyncStatusIndicatorProps } from "./SyncStatusIndicator";
export { LoadingIndicator } from "./LoadingIndicator";
export { EnableTouchActiveStates } from "./EnableTouchActiveStates";
