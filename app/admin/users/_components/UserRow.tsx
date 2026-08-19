"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
// ROLES/ROLE_DESCRIPTIONS/UserRole from @/shared/roles, NOT @/core/admin —
// same client-bundle-safety reason as AddUserForm.tsx (see
// src/shared/roles.ts's comment). UserListRow is imported separately,
// type-only, from @/core/admin: a type-only import is fully erased at
// compile time (isolatedModules), so it never reaches the client bundle
// and does not trigger the same problem.
import { ROLES, ROLE_DESCRIPTIONS, type UserRole } from "@/shared/roles";
import type { UserListRow } from "@/core/admin";
import styles from "../../shared.module.css";

type RowMode = "idle" | "confirmDeactivate";
type ActionStatus = "idle" | "saving" | "error";

// T-G3: one row of the team table (app/admin/users/page.tsx). Owns its own
// local state so one row's in-flight save/error/reveal never affects the
// others. `isSelf` disables the actions the acting admin cannot take on
// their own account (deactivate, change own role — src/core/admin/
// actions.ts deactivateUser/changeUserRole both refuse these server-side
// too; the disabled state here is a courtesy, not the real guard).
export function UserRow({ user, isSelf }: { user: UserListRow; isSelf: boolean }) {
  const router = useRouter();
  const isActive = user.deactivatedAtIso === null;

  const [mode, setMode] = useState<RowMode>("idle");
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [roleStatus, setRoleStatus] = useState<ActionStatus>("idle");
  const [roleError, setRoleError] = useState("");

  const [deactivateStatus, setDeactivateStatus] = useState<ActionStatus>("idle");
  const [deactivateError, setDeactivateError] = useState("");

  const [linkStatus, setLinkStatus] = useState<ActionStatus>("idle");
  const [linkError, setLinkError] = useState("");
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkExpiresAtIso, setLinkExpiresAtIso] = useState<string | null>(null);

  async function saveRole() {
    if (selectedRole === user.role) return;
    setRoleStatus("saving");
    setRoleError("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setRoleError(body?.error ?? "Could not change this user's role.");
        setRoleStatus("error");
        return;
      }
      setRoleStatus("idle");
      router.refresh();
    } catch {
      setRoleError("Network error. Check your connection and try again.");
      setRoleStatus("error");
    }
  }

  async function confirmDeactivate() {
    setDeactivateStatus("saving");
    setDeactivateError("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/deactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setDeactivateError(body?.error ?? "Could not deactivate this user.");
        setDeactivateStatus("error");
        return;
      }
      setDeactivateStatus("idle");
      setMode("idle");
      router.refresh();
    } catch {
      setDeactivateError("Network error. Check your connection and try again.");
      setDeactivateStatus("error");
    }
  }

  async function reactivate() {
    setDeactivateStatus("saving");
    setDeactivateError("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/reactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setDeactivateError(body?.error ?? "Could not reactivate this user.");
        setDeactivateStatus("error");
        return;
      }
      setDeactivateStatus("idle");
      router.refresh();
    } catch {
      setDeactivateError("Network error. Check your connection and try again.");
      setDeactivateStatus("error");
    }
  }

  async function createSignInLink() {
    setLinkStatus("saving");
    setLinkError("");
    setLinkUrl(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/sign-in-link`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setLinkError(body?.error ?? "Could not create a sign-in link.");
        setLinkStatus("error");
        return;
      }
      const body = (await res.json()) as { verifyPath: string; expiresAtIso: string };
      const url = new URL(body.verifyPath, window.location.origin).toString();
      setLinkUrl(url);
      setLinkExpiresAtIso(body.expiresAtIso);
      setLinkStatus("idle");
    } catch {
      setLinkError("Network error. Check your connection and try again.");
      setLinkStatus("error");
    }
  }

  return (
    <tr>
      <td className={styles.td}>
        {user.email}
        {isSelf ? <span className={styles.emptyCellMuted}> (you)</span> : null}
      </td>
      <td className={styles.td}>
        <div className={styles.rowActions}>
          <select
            className={styles.roleSelect}
            aria-label={`Role for ${user.email}`}
            value={selectedRole}
            disabled={isSelf || roleStatus === "saving"}
            onChange={(e) => setSelectedRole(e.target.value as UserRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_DESCRIPTIONS[r].label}
              </option>
            ))}
          </select>
          {!isSelf && selectedRole !== user.role ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={roleStatus === "saving"}
              onClick={saveRole}
            >
              {roleStatus === "saving" ? "Saving…" : "Save role"}
            </button>
          ) : null}
        </div>
        {roleStatus === "error" && roleError ? (
          <p className={styles.fieldError} role="alert">
            {roleError}
          </p>
        ) : null}
      </td>
      <td className={styles.td}>
        {isActive ? (
          <span className={styles.statusBadgeOk}>
            <span className={styles.statusDot} aria-hidden="true" />
            Active
          </span>
        ) : (
          <span className={styles.statusBadgeMuted}>
            <span className={styles.statusDot} aria-hidden="true" />
            Deactivated
          </span>
        )}
      </td>
      <td className={styles.tdNum}>{user.createdAtIso.slice(0, 10)}</td>
      <td className={styles.td}>
        <div className={styles.rowActions}>
          {isActive ? (
            isSelf ? (
              <span className={styles.emptyCellMuted}>Cannot deactivate your own account</span>
            ) : mode === "confirmDeactivate" ? null : (
              <button
                type="button"
                className={styles.dangerButton}
                disabled={deactivateStatus === "saving"}
                onClick={() => setMode("confirmDeactivate")}
              >
                Deactivate
              </button>
            )
          ) : (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={deactivateStatus === "saving"}
              onClick={reactivate}
            >
              {deactivateStatus === "saving" ? "Reactivating…" : "Reactivate"}
            </button>
          )}

          {isActive ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={linkStatus === "saving"}
              onClick={createSignInLink}
            >
              {linkStatus === "saving" ? "Creating…" : "Create sign-in link"}
            </button>
          ) : null}
        </div>

        {deactivateStatus === "error" && deactivateError ? (
          <p className={styles.fieldError} role="alert">
            {deactivateError}
          </p>
        ) : null}

        {mode === "confirmDeactivate" ? (
          <div className={styles.confirmPanel} role="alertdialog" aria-label={`Confirm deactivating ${user.email}`}>
            <p className={styles.confirmHeading}>Deactivate {user.email}?</p>
            <p className={styles.confirmBody}>
              They will no longer be able to sign in, and any deactivated session they are already using will be
              refused on their next action here. Their past assessments, determinations, and audit history stay on
              record. You can reactivate them later.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={deactivateStatus === "saving"}
                onClick={confirmDeactivate}
              >
                {deactivateStatus === "saving" ? "Deactivating…" : "Yes, deactivate"}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={deactivateStatus === "saving"}
                onClick={() => setMode("idle")}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {linkStatus === "error" && linkError ? (
          <p className={styles.fieldError} role="alert">
            {linkError}
          </p>
        ) : null}

        {linkUrl ? (
          <div className={styles.linkRevealBox} role="status">
            <p className={styles.linkRevealHeading}>Sign-in link for {user.email}</p>
            <div className={styles.linkRevealUrlRow}>
              <input
                className={styles.linkRevealUrl}
                readOnly
                value={linkUrl}
                aria-label={`Sign-in link URL for ${user.email}`}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <p className={styles.linkRevealHint}>
              Single use. Expires{" "}
              {linkExpiresAtIso
                ? new Date(linkExpiresAtIso).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "in 24 hours"}
              . Hand this link to {user.email} over any channel (text, phone, in person). It is shown once and is
              not stored anywhere you can come back to see it again.
            </p>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
