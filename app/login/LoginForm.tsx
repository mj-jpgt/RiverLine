"use client";

import { useId, useState, type FormEvent } from "react";
import styles from "./page.module.css";

type Status = "idle" | "loading" | "sent" | "error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const trimmedEmail = email.trim();
  const isValidEmail = EMAIL_RE.test(trimmedEmail);
  const touched = email.length > 0;
  const showValidationError = touched && !isValidEmail;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidEmail || status === "loading") return;

    setStatus("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? "Something went wrong. Try again.");
        setStatus("error");
        return;
      }

      setStatus("sent");
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor={emailId} className={styles.label}>
          Email address
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={status === "loading"}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          className={`${styles.input} ${showValidationError ? styles.inputError : ""}`.trim()}
          aria-invalid={showValidationError || status === "error"}
          aria-describedby={
            showValidationError ? `${emailId}-error` : status === "error" ? `${emailId}-server-error` : undefined
          }
        />
        {showValidationError ? (
          <p id={`${emailId}-error`} className={styles.errorText}>
            Enter a valid email address.
          </p>
        ) : null}
        {status === "error" ? (
          <p id={`${emailId}-server-error`} className={styles.errorText}>
            {errorMessage}
          </p>
        ) : null}
        {status === "sent" ? (
          <p className={styles.statusText} role="status">
            If that email is on the roster, a sign-in link was sent. Check your inbox.
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        className={styles.submit}
        disabled={!isValidEmail || status === "loading"}
      >
        {status === "loading" ? "Sending…" : "Send sign-in link"}
      </button>

      <p className={styles.helpText}>
        No account? RiverLine accounts are issued by your jurisdiction
        administrator. There is no self-signup.
      </p>
    </form>
  );
}
