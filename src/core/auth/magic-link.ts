// Magic-link issuance and verification. Per specs/constitution.md §6 and
// docs/riverline-sdd-build-spec.md §2.6: allowlist only (users exist only
// via seed/invite — no self-signup route anywhere in this module), single-
// use hashed token, 15-minute expiry.
import { withSystem } from "@/shared/db";
import { generateOpaqueToken, hashToken } from "./crypto";
import { sendMagicLinkEmail } from "./email-transport";
import type { Role } from "./session";

const TOKEN_TTL_MINUTES = 15;

// G3: on-demand admin-generated sign-in links (invite pathway, see
// src/core/admin/actions.ts generateSignInLink). Longer than the 15-minute
// self-requested window because the admin hands this URL to someone over
// another channel (text, phone, in person) rather than it landing in an
// inbox seconds after being requested.
const INVITE_LINK_TTL_HOURS = 24;

interface AllowlistedUser {
  id: string;
  email: string;
  jurisdictionId: string;
  role: Role;
  deactivatedAt: string | null;
}

interface VerifiedLogin {
  userId: string;
  jurisdictionId: string;
  role: Role;
  email: string;
}

/**
 * Looks up the email against the allowlist (the `users` table — there is no
 * other allowlist store; users exist only via seed/invite). If found, issues
 * a single-use token. Always resolves the same way regardless of whether the
 * email is allowlisted, so the response shape never leaks allowlist
 * membership.
 */
export async function requestMagicLink(emailRaw: string): Promise<{ requested: true }> {
  const email = emailRaw.trim().toLowerCase();

  const user = await withSystem(async (client) => {
    const { rows } = await client.query<{
      id: string;
      email: string;
      jurisdiction_id: string;
      role: Role;
      deactivated_at: string | null;
    }>(`select id, email, jurisdiction_id, role, deactivated_at from users where email = $1`, [email]);
    return rows[0]
      ? ({
          id: rows[0].id,
          email: rows[0].email,
          jurisdictionId: rows[0].jurisdiction_id,
          role: rows[0].role,
          deactivatedAt: rows[0].deactivated_at,
        } satisfies AllowlistedUser)
      : null;
  });

  // Same response whether the email is unknown OR deactivated — response
  // shape must never leak allowlist membership or account status
  // (see the existing !user branch's comment above the function).
  if (!user || user.deactivatedAt !== null) {
    return { requested: true };
  }

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await withSystem((client) =>
    client.query(
      `insert into login_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt],
    ),
  );

  const verifyPath = `/api/auth/verify?token=${encodeURIComponent(token)}`;

  // Delivery goes through the driver-selected transport (dev log+store /
  // real HTTP send via a provider API / loud throw when unconfigured) — see
  // src/core/auth/email-transport.ts and docs/adr/0009-email-transport.md.
  // This throws in production until EMAIL_DRIVER=http is configured with a
  // provider (docs/BLOCKERS.md B4); the pre-existing dev behavior (console
  // log + dev-only retrieval route) is unchanged in shape.
  await sendMagicLinkEmail({ email, verifyPath, expiresAt });

  return { requested: true };
}

/**
 * Verifies and consumes a single-use token. Returns the login payload (for
 * building a session cookie) or null if the token is missing, expired, or
 * already used.
 */
export async function verifyMagicLink(token: string): Promise<VerifiedLogin | null> {
  const tokenHash = hashToken(token);

  return withSystem(async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
    }>(`select id, user_id, expires_at, used_at from login_tokens where token_hash = $1`, [
      tokenHash,
    ]);
    const row = rows[0];
    if (!row) return null;
    if (row.used_at !== null) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    await client.query(`update login_tokens set used_at = now() where id = $1`, [row.id]);

    const { rows: userRows } = await client.query<{
      id: string;
      email: string;
      jurisdiction_id: string;
      role: Role;
      deactivated_at: string | null;
    }>(`select id, email, jurisdiction_id, role, deactivated_at from users where id = $1`, [row.user_id]);
    const user = userRows[0];
    if (!user) return null;
    // Deactivated since the token was issued (or the token was an
    // admin-generated invite link for a user deactivated before it was
    // ever used): the token is now consumed (used_at set above) but
    // refused — a deactivated account can never complete sign-in, whether
    // via a self-requested link or an admin's on-demand invite link.
    if (user.deactivated_at !== null) return null;

    return {
      userId: user.id,
      jurisdictionId: user.jurisdiction_id,
      role: user.role,
      email: user.email,
    };
  });
}

/**
 * Mints a single-use sign-in link for a SPECIFIC user, on demand — the
 * no-email onboarding pathway (T-G3 / docs/BLOCKERS.md B4). Unlike
 * requestMagicLink, this is never triggered by the user themselves and
 * never goes through the email transport: an admin calls this (via
 * src/core/admin/actions.ts generateSignInLink, which is responsible for
 * authorization, jurisdiction scoping, rate limiting, and the audit_log
 * write) and is handed the raw token back to build a URL that gets
 * verified through the exact same /api/auth/verify route and
 * verifyMagicLink() above as a real magic link — the only difference is
 * how the token reached the person (handed to them directly, not emailed)
 * and its longer expiry window (24h vs 15min), appropriate for a link
 * relayed over another channel rather than clicked seconds after request.
 *
 * Never logs the raw token — the caller must not log it either (see
 * generateSignInLink's own comment). Uses login_tokens + the same
 * crypto primitives (generateOpaqueToken/hashToken) requestMagicLink uses;
 * no new token machinery.
 */
export async function issueSignInLinkForUser(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_LINK_TTL_HOURS * 60 * 60 * 1000);

  await withSystem((client) =>
    client.query(`insert into login_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)`, [
      userId,
      tokenHash,
      expiresAt,
    ]),
  );

  return { token, expiresAt };
}
