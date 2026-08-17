// Public entry point for src/core/auth — the only path app/ (or any other
// core family) may import through, per eslint-plugin-boundaries
// (docs/adr/0003-module-boundary-enforcement.md).
export { requestMagicLink, verifyMagicLink } from "./magic-link";
export {
  createSessionCookieValue,
  verifySessionCookie,
  SESSION_COOKIE_NAME,
  type SessionPayload,
  type Role,
} from "./session";
export { requireRole, AuthError } from "./role-guard";
export { getDevMagicLink } from "./dev-link-store";
