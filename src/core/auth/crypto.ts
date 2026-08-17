// Token primitives for magic-link auth. node:crypto only — no new
// dependency (AGENTS.md rule 3 / SUBAGENT.md "Do not add dependencies").
import { randomBytes, createHash } from "node:crypto";

/** 32 random bytes, base64url-encoded. This is the token emailed/logged to
 * the user — it is never stored raw, only its hash (see hashToken). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex digest. What's actually persisted in login_tokens.token_hash —
 * a leaked database row does not hand out usable tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
