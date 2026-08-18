import styles from "./nav.module.css";

// Renders the raw role string as-is (no relabeling) so it stays the literal
// value test/e2e/login.spec.ts asserts (`getByText("assessor", { exact:
// true })`) — visual capitalization is CSS-only (text-transform), which does
// not change the accessible/text-content match.
export function RoleChip({ role }: { role: string }) {
  return <span className={styles.roleChip}>{role}</span>;
}
