import type { Role, SessionPayload } from "./session";

export class AuthError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Role-guard helper for route handlers / server components. Throws
 * AuthError("UNAUTHENTICATED") if there's no session, or
 * AuthError("FORBIDDEN") if the session's role isn't in `allowed`. Returns
 * the session (narrowed) on success so callers can use it immediately.
 */
export function requireRole(
  session: SessionPayload | null,
  allowed: readonly Role[],
): SessionPayload {
  if (!session) {
    throw new AuthError("UNAUTHENTICATED", "No active session.");
  }
  if (!allowed.includes(session.role)) {
    throw new AuthError(
      "FORBIDDEN",
      `Role '${session.role}' is not permitted here; requires one of: ${allowed.join(", ")}.`,
    );
  }
  return session;
}
