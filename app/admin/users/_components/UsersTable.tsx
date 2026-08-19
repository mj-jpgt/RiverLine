import type { UserListRow } from "@/core/admin";
import { UserRow } from "./UserRow";
import styles from "../../shared.module.css";

// Server-renderable list wrapper — the interactive parts live in UserRow
// (one "use client" component per row, same split CostTablesPage's list +
// CostTableForm establishes: static shell server-rendered, interactivity
// isolated to the smallest client boundary).
export function UsersTable({ users, currentUserId }: { users: UserListRow[]; currentUserId: string }) {
  if (users.length === 0) {
    return (
      <div className={styles.statePanel}>
        <p className={styles.statePanelText}>No team members yet. Add the first one below.</p>
      </div>
    );
  }

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.th}>
              Email
            </th>
            <th scope="col" className={styles.th}>
              Role
            </th>
            <th scope="col" className={styles.th}>
              Status
            </th>
            <th scope="col" className={styles.th}>
              Created
            </th>
            <th scope="col" className={styles.th}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow key={user.id} user={user} isSelf={user.id === currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
