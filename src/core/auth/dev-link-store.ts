// Dev-only in-memory store of the most recent pending magic link per email,
// so a dev-only route can hand it back for local testing (no mailbox in
// dev). Never imported/used when NODE_ENV === 'production' — enforced both
// here (no-op) and again at the route layer (defense in depth), per
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
interface DevLinkEntry {
  url: string;
  expiresAt: Date;
}

const GLOBAL_KEY = "__riverlineDevMagicLinkStore__";

function getStore(): Map<string, DevLinkEntry> {
  const g = globalThis as unknown as Record<string, Map<string, DevLinkEntry> | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map();
  }
  return g[GLOBAL_KEY];
}

export function setDevMagicLink(email: string, url: string, expiresAt: Date): void {
  if (process.env.NODE_ENV === "production") return;
  getStore().set(email, { url, expiresAt });
}

export function getDevMagicLink(email: string): DevLinkEntry | null {
  if (process.env.NODE_ENV === "production") return null;
  const store = getStore();
  const entry = store.get(email);
  if (!entry) return null;
  if (entry.expiresAt.getTime() < Date.now()) {
    store.delete(email);
    return null;
  }
  return entry;
}
