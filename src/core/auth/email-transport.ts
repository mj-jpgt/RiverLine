// Pluggable email transport for magic-link delivery (docs/BLOCKERS.md B4).
// Driver is selected by the EMAIL_DRIVER env var:
//
//   - "dev"  : logs the link server-side and stashes it in the dev-link
//              store for the dev-only retrieval route
//              (app/api/dev/magic-link). This is the pre-existing dev
//              behavior, unchanged in shape. Refuses to run when
//              NODE_ENV === "production" — defense in depth, matching
//              dev-link-store.ts's own gate.
//   - "http" : POSTs to a transactional email provider's plain HTTPS JSON
//              API via the global `fetch` — no new npm dependency
//              (AGENTS.md rule 3). Ships a tested payload builder for
//              Postmark, the #1 recommendation in
//              docs/adr/0009-email-transport.md. Provider base URL, auth
//              token, and from-address are env-driven (EMAIL_API_URL,
//              EMAIL_API_KEY, EMAIL_FROM) — never hardcoded secrets.
//   - "none" : throws a clear, loud error. This is the default when
//              EMAIL_DRIVER is unset in production, matching the
//              pre-existing throw magic-link.ts used to do inline. Never a
//              silent no-op — AGENTS.md rule 7's spirit (surface failure,
//              don't hide it) applies here even though this isn't the sync
//              queue.
//
// Unset EMAIL_DRIVER resolves to "dev" outside production, "none" in
// production — so a fresh production deploy with no email configuration
// fails loudly instead of pretending to work.
//
// Security: this module never logs or embeds the raw token anywhere except
// inside verifyUrl, and verifyUrl only ever reaches (a) the dev-only
// console.log/dev-link-store path (unreachable in production, enforced in
// resolveEmailDriver()) or (b) the outbound HTTPS request body sent
// directly to the configured provider. Error paths never echo verifyUrl.
import { setDevMagicLink } from "./dev-link-store";

const TOOL_NAME = "RiverLine";
const EXPIRY_MINUTES = 15;

export interface MagicLinkEmailInput {
  email: string;
  /** Relative path, e.g. "/api/auth/verify?token=...". */
  verifyPath: string;
  expiresAt: Date;
}

export type EmailDriverName = "dev" | "http" | "none";

/**
 * Resolves which driver to use from EMAIL_DRIVER, applying the
 * production-safe defaults and refusing unsafe combinations.
 */
export function resolveEmailDriver(): EmailDriverName {
  const raw = process.env.EMAIL_DRIVER?.trim().toLowerCase();
  if (raw && raw !== "dev" && raw !== "http" && raw !== "none") {
    throw new Error(`Unknown EMAIL_DRIVER "${raw}" — expected "dev", "http", or "none".`);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const driver: EmailDriverName = (raw as EmailDriverName | undefined) ?? (isProduction ? "none" : "dev");

  if (driver === "dev" && isProduction) {
    // Never allow the dev bypass to run in production, even if someone
    // misconfigures EMAIL_DRIVER=dev on a prod deploy.
    throw new Error(
      'EMAIL_DRIVER="dev" is not allowed when NODE_ENV=production — see docs/BLOCKERS.md B4.',
    );
  }

  return driver;
}

/** Plain-text body. Mandatory part — institutional, no marketing, no images. */
export function buildMagicLinkEmailText(verifyUrl: string): string {
  return [
    `${TOOL_NAME} sign-in link`,
    "",
    `Use the link below to sign in to ${TOOL_NAME}:`,
    verifyUrl,
    "",
    `This link expires in ${EXPIRY_MINUTES} minutes.`,
    "",
    "If you did not request this, ignore this email.",
  ].join("\n");
}

/** Simple HTML body — optional part, no images, no tracking pixels. */
export function buildMagicLinkEmailHtml(verifyUrl: string): string {
  const escapedUrl = verifyUrl
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // Named CSS colors, not hex: this is email-client HTML, which tokens.css
  // (an app stylesheet) cannot reach — named colors also have the broadest
  // legacy email-client support, and this repo's design-token lint rule
  // (riverline/no-raw-color-or-arbitrary-value) correctly does not special-
  // case this file, so this is the honest way to satisfy both constraints.
  return (
    `<!doctype html><html><body style="font-family:sans-serif;color:black;background:white;margin:0;padding:24px;">` +
    `<p>${TOOL_NAME} sign-in link</p>` +
    `<p>Use the link below to sign in to ${TOOL_NAME}:</p>` +
    `<p><a href="${escapedUrl}">${escapedUrl}</a></p>` +
    `<p>This link expires in ${EXPIRY_MINUTES} minutes.</p>` +
    `<p>If you did not request this, ignore this email.</p>` +
    `</body></html>`
  );
}

/**
 * Postmark's single-email send payload
 * (https://postmarkapp.com/developer/api/email-api, retrieved 2026-08-17 —
 * see docs/adr/0009-email-transport.md for the full citation trail).
 * Exported so the payload can be asserted exactly in tests.
 */
export interface PostmarkEmailPayload {
  From: string;
  To: string;
  Subject: string;
  TextBody: string;
  HtmlBody: string;
  MessageStream: string;
}

export function buildPostmarkPayload(input: {
  to: string;
  from: string;
  verifyUrl: string;
}): PostmarkEmailPayload {
  return {
    From: input.from,
    To: input.to,
    Subject: `${TOOL_NAME} sign-in link`,
    TextBody: buildMagicLinkEmailText(input.verifyUrl),
    HtmlBody: buildMagicLinkEmailHtml(input.verifyUrl),
    MessageStream: "outbound",
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set to use EMAIL_DRIVER=http. See .env.example.`);
  }
  return value;
}

function requireAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL;
  if (!raw) {
    throw new Error("APP_BASE_URL must be set to send real magic-link email (EMAIL_DRIVER=http).");
  }
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production" && !trimmed.startsWith("https://")) {
    throw new Error("APP_BASE_URL must be an https:// URL in production.");
  }
  return trimmed;
}

async function sendViaHttp(to: string, verifyUrl: string): Promise<void> {
  const apiUrl = requireEnv("EMAIL_API_URL");
  const apiKey = requireEnv("EMAIL_API_KEY");
  const from = requireEnv("EMAIL_FROM");

  const payload = buildPostmarkPayload({ to, from, verifyUrl });

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(
      `Email transport (http) network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    // The provider's error body never contains our raw token (Postmark
    // doesn't echo request fields back), so it's safe to include as-is.
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Email transport (http) failed: ${response.status} ${response.statusText} — ${bodyText.slice(0, 500)}`,
    );
  }
}

/**
 * Sends the magic-link email through whichever driver EMAIL_DRIVER
 * resolves to. Throws on "none" (unconfigured production) and on any
 * "http" delivery failure; the caller (magic-link.ts's requestMagicLink)
 * does not catch these — they propagate to the route handler, which logs
 * server-side and returns a generic 500, matching the pre-existing
 * behavior of the inline production throw this replaces.
 */
export async function sendMagicLinkEmail(input: MagicLinkEmailInput): Promise<void> {
  const driver = resolveEmailDriver();

  if (driver === "none") {
    throw new Error(
      "Production email transport is not configured — set EMAIL_DRIVER=http plus " +
        "EMAIL_API_URL/EMAIL_API_KEY/EMAIL_FROM (see .env.example and " +
        "docs/adr/0009-email-transport.md), or see docs/BLOCKERS.md B4.",
    );
  }

  if (driver === "dev") {
    if (process.env.NODE_ENV === "production") {
      // Unreachable given resolveEmailDriver()'s own guard, but kept as an
      // explicit second gate — the same "defense in depth" pattern
      // dev-link-store.ts uses for the exact same class of mistake.
      throw new Error("Refusing to run the dev email driver in production.");
    }
    console.log(`[dev-auth] magic link for ${input.email}: ${input.verifyPath}`);
    setDevMagicLink(input.email, input.verifyPath, input.expiresAt);
    return;
  }

  // driver === "http"
  const baseUrl = requireAppBaseUrl();
  const verifyUrl = `${baseUrl}${input.verifyPath}`;
  await sendViaHttp(input.email, verifyUrl);
}
