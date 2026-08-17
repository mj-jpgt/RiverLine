// Session cookie: httpOnly, signed, 12h expiry (spec §7.1 — "sessions expire
// at 12 hours"). Stateless (no sessions table): the cookie itself carries
// user id + jurisdiction id + role, HMAC-signed with SESSION_SECRET so it
// can't be forged or tampered with client-side. node:crypto only.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "riverline_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h, specs/riverline-sdd-build-spec.md §7.1

export type Role = "admin" | "assessor" | "official" | "viewer";

export interface SessionPayload {
  userId: string;
  jurisdictionId: string;
  role: Role;
  email: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is not set (or too short — need >=32 chars). See .env.example.",
    );
  }
  return secret;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createSessionCookieValue(
  input: Pick<SessionPayload, "userId" | "jurisdictionId" | "role" | "email">,
): { value: string; maxAgeSeconds: number } {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...input, iat: now, exp: now + SESSION_TTL_SECONDS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = sign(payloadB64, getSecret());
  return { value: `${payloadB64}.${sig}`, maxAgeSeconds: SESSION_TTL_SECONDS };
}

export function verifySessionCookie(value: string | undefined | null): SessionPayload | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  let expectedSig: string;
  try {
    expectedSig = sign(payloadB64, getSecret());
  } catch {
    return null;
  }

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;

  return payload;
}
