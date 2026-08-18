// Magic-link issuance and verification. Per specs/constitution.md §6 and
// docs/riverline-sdd-build-spec.md §2.6: allowlist only (users exist only
// via seed/invite — no self-signup route anywhere in this module), single-
// use hashed token, 15-minute expiry.
import { withSystem } from "@/shared/db";
import { generateOpaqueToken, hashToken } from "./crypto";
import { sendMagicLinkEmail } from "./email-transport";
import type { Role } from "./session";

const TOKEN_TTL_MINUTES = 15;

interface AllowlistedUser {
  id: string;
  email: string;
  jurisdictionId: string;
  role: Role;
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
    }>(`select id, email, jurisdiction_id, role from users where email = $1`, [email]);
    return rows[0]
      ? ({
          id: rows[0].id,
          email: rows[0].email,
          jurisdictionId: rows[0].jurisdiction_id,
          role: rows[0].role,
        } satisfies AllowlistedUser)
      : null;
  });

  if (!user) {
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
    }>(`select id, email, jurisdiction_id, role from users where id = $1`, [row.user_id]);
    const user = userRows[0];
    if (!user) return null;

    return {
      userId: user.id,
      jurisdictionId: user.jurisdiction_id,
      role: user.role,
      email: user.email,
    };
  });
}
