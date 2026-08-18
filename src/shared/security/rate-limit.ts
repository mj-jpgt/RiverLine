// Boring in-memory sliding-window rate limiter. No Redis, no queue, no
// external store — AGENTS.md's over-engineering rule ("Redis, message
// queues... for a system that will hold a few thousand records" gets
// rejected without discussion) and build-spec §11.8's load reality ("tens
// of users") both argue against anything heavier than this. Single-process
// assumption matches the deploy target (build spec §2.8: Vercel or a single
// VPS) — every route this guards runs in the same long-lived Node process.
//
// Keyed on globalThis, the same trick src/core/auth/dev-link-store.ts uses
// and documents: Next dev-mode compiles separate route bundles per handler,
// so a plain module-level Map would silently become N independent counters
// instead of one shared limiter (verified there via curl in T-C1; the same
// module-splitting applies here).
//
// See docs/security-review.md "Rate limiting" for the specific per-route
// limit/window numbers chosen and the documented reasoning behind each one
// (never invented as "industry standard" — AGENTS.md/SUBAGENT.md forbid
// that).

interface Bucket {
  /** Epoch-ms timestamps of hits still inside the current window, oldest first. */
  hits: number[];
}

interface RateLimitStore {
  buckets: Map<string, Bucket>;
}

function getStore(): RateLimitStore {
  const g = globalThis as unknown as { __riverlineRateLimitStore?: RateLimitStore };
  if (!g.__riverlineRateLimitStore) {
    g.__riverlineRateLimitStore = { buckets: new Map() };
  }
  return g.__riverlineRateLimitStore;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits remaining in the current window if allowed; 0 if rejected. */
  remaining: number;
  /** Seconds the caller should wait before retrying; 0 if allowed. */
  retryAfterSeconds: number;
}

/**
 * Amortized cleanup so a long-running process doesn't accumulate one bucket
 * per email/IP ever seen, forever. No timer/interval (stays serverless-
 * friendly, no background work) — just an occasional sweep piggybacked on a
 * real call. One hour is comfortably above every window this module's
 * callers use (see docs/security-review.md), so anything not touched in the
 * last hour is safe to drop.
 */
function maybePrune(store: RateLimitStore, now: number): void {
  if (Math.random() > 0.005) return;
  const cutoff = now - 60 * 60 * 1000;
  for (const [key, bucket] of store.buckets) {
    const last = bucket.hits[bucket.hits.length - 1];
    if (last === undefined || last < cutoff) {
      store.buckets.delete(key);
    }
  }
}

/**
 * Sliding-window rate check. `key` identifies the caller+bucket (e.g.
 * `"request-link:email:foo@example.gov"` or `"sync:user:<uuid>"`) — callers
 * are responsible for building a key that separates buckets the way they
 * intend (per-route, per-identifier). Every allowed call counts as one hit
 * against the window; rejected calls do not count again.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const store = getStore();
  const now = Date.now();
  maybePrune(store, now);

  const existing = store.buckets.get(key);
  const hits = (existing?.hits ?? []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    store.buckets.set(key, { hits });
    const oldest = hits[0] as number;
    const retryAfterMs = windowMs - (now - oldest);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  hits.push(now);
  store.buckets.set(key, { hits });
  return { allowed: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

/** Best-effort client IP from standard proxy headers. Trusts
 * X-Forwarded-For's first hop, which is only meaningful behind a proxy that
 * sets it correctly (Vercel does; a self-hosted deploy needs Caddy/whatever
 * front door configured to set it — see docs/security-review.md "Rate
 * limiting" for the W4/deploy coordination note). Falls back to a constant
 * so every un-proxied request shares one bucket rather than throwing —
 * degrades to "IP-blind" rather than crashing the route. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Builds the standard 429 JSON response this codebase's routes return on a
 * rejected check, with Retry-After set (seconds, per RFC 9110 §10.2.3). */
export function rateLimitResponse(result: RateLimitResult, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSeconds),
    },
  });
}
