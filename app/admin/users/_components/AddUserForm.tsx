"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
// From @/shared/roles, NOT @/core/admin: this is a "use client" component,
// and @/core/admin's barrel also re-exports src/core/admin/queries.ts +
// actions.ts, which import the `pg` driver — importing ANY runtime value
// from that barrel breaks the client bundle ("Module not found: Can't
// resolve 'fs'", from pg-connection-string). See src/shared/roles.ts's
// comment for the full reasoning.
import { ROLES, ROLE_DESCRIPTIONS, type UserRole } from "@/shared/roles";
import styles from "../../shared.module.css";

type Status = "idle" | "saving" | "error";

// T-G3 "Add a team member" form: email + role only (AGENTS.md rule 8 — no
// password field exists anywhere in this app; no other field is collected
// here). Creating the row IS the invite (schema/core.sql's magic-link
// allowlist model), so the success state has to say plainly what happens
// next — and that depends on whether the admin generates a sign-in link
// for the new user right away (they can, from the row that appears in the
// table below) or waits for the email transport to be configured
// (docs/BLOCKERS.md B4).
export function AddUserForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("assessor");
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const emailMissing = touchedEmail && email.trim().length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouchedEmail(true);
    setErrorMessage("");
    setSuccessEmail(null);

    if (email.trim().length === 0) return;

    setStatus("saving");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Could not add this team member.");
        setStatus("error");
        return;
      }
      setStatus("idle");
      setSuccessEmail(email.trim());
      setEmail("");
      setTouchedEmail(false);
      // Deferred, not called synchronously here: router.refresh() re-fetches
      // this page's server-rendered team list (so the new row appears
      // without a full reload), but calling it in the same tick as the
      // state updates above let React batch them into one commit where the
      // freshly-fetched RSC payload replaced this form before the success
      // message ever painted — the confirmation a real admin needs to read
      // ("X was added and can now sign in...") never became visible.
      // Pushing it to the next tick lets the success state commit and
      // paint first.
      setTimeout(() => router.refresh(), 0);
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="new-user-email">
          Email address (required)
        </label>
        <input
          id="new-user-email"
          type="email"
          className={styles.textInput}
          value={email}
          disabled={status === "saving"}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouchedEmail(true)}
          placeholder="name@example.gov"
        />
        {emailMissing ? (
          <p className={styles.fieldError} role="alert">
            An email address is required.
          </p>
        ) : null}
        <p className={styles.formHint}>
          This person becomes eligible to sign in with this email as soon as you add them. No password is ever set;
          this app signs people in with a one-time link.
        </p>
      </div>

      <div className={styles.formRowWide}>
        <p className={styles.formLabel} id="role-picker-label">
          Role
        </p>
        <div className={styles.roleOptionList} role="radiogroup" aria-labelledby="role-picker-label">
          {ROLES.map((r) => (
            <label key={r} className={r === role ? styles.roleOptionSelected : styles.roleOption}>
              <input
                type="radio"
                name="role"
                value={r}
                checked={role === r}
                disabled={status === "saving"}
                onChange={() => setRole(r)}
                aria-label={ROLE_DESCRIPTIONS[r].label}
              />
              <span className={styles.roleOptionText}>
                <span className={styles.roleOptionLabel}>{ROLE_DESCRIPTIONS[r].label}</span>
                <span className={styles.roleOptionDescription}>{ROLE_DESCRIPTIONS[r].description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {status === "error" && errorMessage ? (
        <p className={styles.fieldError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      {successEmail ? (
        <div className={styles.successPanel} role="status">
          <p className={styles.statePanelText}>
            {successEmail} was added and can now sign in. If email is not yet configured for this jurisdiction, use
            &quot;Create sign-in link&quot; on their row below to hand them a link directly.
          </p>
        </div>
      ) : null}

      <button type="submit" className={styles.primaryButton} disabled={status === "saving"}>
        {status === "saving" ? "Adding…" : "Add team member"}
      </button>
    </form>
  );
}
