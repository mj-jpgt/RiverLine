import { withTenant } from "@/shared/db";
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

/**
 * G3 addition: same role check as requireRole, PLUS a live DB check that
 * the session's user has not been deactivated since the session cookie was
 * issued (schema addition: users.deactivated_at, migrations/
 * 0007_users_deactivated.sql). Sessions here are stateless, signed cookies
 * (src/core/auth/session.ts) with no DB-backed session store, so a
 * deactivation can never be pushed into an already-issued cookie — this is
 * the request-time check that catches it on the next request instead.
 *
 * Deliberately a NEW function, not a change to requireRole itself:
 * requireRole is called synchronously (no `await`) from ~40 existing
 * pages/routes across every other agent's module. Changing its signature
 * to async would silently break every one of those call sites' typecheck
 * without this task touching a single one of those files directly, which
 * is worse than leaving them alone. requireActiveRole is additive and used
 * by src/core/admin's own team-management routes (the surface a
 * deactivated admin or team member would most plausibly still try to use);
 * see docs/journal/2026-08-18-g3-users.md for the scope note on why this
 * is not yet wired into every route in the app.
 */
export async function requireActiveRole(
  session: SessionPayload | null,
  allowed: readonly Role[],
): Promise<SessionPayload> {
  const guarded = requireRole(session, allowed);

  const deactivated = await withTenant(guarded.jurisdictionId, guarded.userId, async (client) => {
    const { rows } = await client.query<{ deactivated_at: string | null }>(
      `select deactivated_at from users where id = $1`,
      [guarded.userId],
    );
    return (rows[0]?.deactivated_at ?? null) !== null;
  });

  if (deactivated) {
    throw new AuthError(
      "FORBIDDEN",
      "This account has been deactivated. Ask a jurisdiction administrator to reactivate it.",
    );
  }

  return guarded;
}
