// Dev-only in-memory store of pending magic links per email, so a dev-only
// route can hand one back for local testing (no mailbox in dev). Never
// imported/used when NODE_ENV === 'production' — enforced both here (no-op)
// and again at the route layer (defense in depth), per
// specs/constitution.md §6: "clearly gated to non-production env, never a
// bypass in production code paths."
//
// Stored on `globalThis`, not a plain module-level variable: Next.js's dev
// server compiles each `route.ts` as a separate module graph, so a
// module-level `Map` here gets re-instantiated per route — the POST
// (request-link) and GET (dev/magic-link) handlers would each see their own
// empty store and never observe each other's writes (verified empirically
// in this session: the link logged server-side was never visible to the
// dev-only GET route until this was moved to globalThis). globalThis is the
// one thing actually shared across the whole Node process, dev-mode
// module-splitting included — the same workaround used for e.g. Prisma
// client singletons under Next.js dev/HMR.
//
// FIX (T-W4, mobile-safari flake — see docs/journal/2026-08-17-w4-deploy.md):
// this used to hold a single "most recent" entry per email. Playwright runs
// `fullyParallel` across two projects (chromium, mobile-safari) and several
// spec files that all request a magic link for the same seeded demo email
// (e.g. assessor@example.gov) and then immediately fetch it back from this
// store. With a single slot per email, a second concurrent request-link call
// could overwrite the first entry before the first caller's GET read it, so
// two different tests could both receive the SAME token URL — the token is
// single-use (`login_tokens.used_at`), so whichever test's GET landed
// second, or whichever navigated second, would consume an already-used
// token and fail to reach /home. That is the exact mobile-safari flake
// reported in T-C2/T-C3/T-C4's journals.
//
// Fix: a per-email FIFO queue instead of a single slot. Every
// `setDevMagicLink` enqueues a new, distinct entry; every
// `getDevMagicLink` dequeues (and removes) the oldest still-valid entry.
// Every test in this codebase does exactly one request-link POST followed
// by exactly one dev-route GET (no polling/retry — verified across
// login.spec.ts, registry.spec.ts, calculation.spec.ts, a2-dashboard.spec.ts,
// determination.spec.ts, a1-letters.spec.ts), so however many concurrent
// requests are in flight for one email, each GET now consumes its own
// distinct, never-before-returned token — no two callers can ever be handed
// the same URL again, regardless of interleaving order.
interface DevLinkEntry {
  url: string;
  expiresAt: Date;
}

const GLOBAL_KEY = "__riverlineDevMagicLinkStore__";

function getStore(): Map<string, DevLinkEntry[]> {
  const g = globalThis as unknown as Record<string, Map<string, DevLinkEntry[]> | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map();
  }
  return g[GLOBAL_KEY];
}

export function setDevMagicLink(email: string, url: string, expiresAt: Date): void {
  if (process.env.NODE_ENV === "production") return;
  const store = getStore();
  const queue = store.get(email) ?? [];
  queue.push({ url, expiresAt });
  store.set(email, queue);
}

export function getDevMagicLink(email: string): DevLinkEntry | null {
  if (process.env.NODE_ENV === "production") return null;
  const store = getStore();
  const queue = store.get(email);
  if (!queue || queue.length === 0) return null;

  const now = Date.now();
  // Drop any expired entries from the front of the queue first — they were
  // never collected and never will be.
  while (queue.length > 0 && (queue[0]?.expiresAt.getTime() ?? Infinity) < now) {
    queue.shift();
  }

  const entry = queue.shift() ?? null;
  if (queue.length === 0) {
    store.delete(email);
  }
  return entry;
}
