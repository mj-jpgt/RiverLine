# 0002 — Offline / PWA / device foundation

Status: Accepted
Date: 2026-08-17

## Context

AGENTS.md and the build spec require a PWA that installs to an iPhone home
screen, works fully offline for field capture (`src/core/capture/`), and
syncs later. Every capability decision here has to be checked against what
iOS Safari actually supports today, not against general web-platform docs —
this product's entire user base is on iPhones (per build-spec §1: "your
users are on iPhones... there is no native app in this project").

## Decisions

### 1. Service worker: Serwist, not a hand-rolled worker, not `next-pwa`

`next-pwa` (the older, more commonly-referenced library) is effectively
unmaintained; Serwist is its actively maintained successor and is one of
the approaches the official Next.js docs point to for building PWAs
(`https://nextjs.org/docs/app/guides/progressive-web-apps`, retrieved
2026-08-17). `@serwist/next` handles the Next.js build-time wiring
(precache manifest injection via `withSerwistInit`); `serwist` itself is a
Workbox-equivalent runtime toolkit (`Serwist` class, `defaultCache` runtime
caching strategies).

Verified compatible with our exact pins in this session, not assumed: added
`serwist@9.5.12` and `@serwist/next@9.5.12` (latest on npm,
`npm view serwist version`), wrote `app/sw.ts` and `next.config.ts` per the
Serwist getting-started doc
(`https://serwist.pages.dev/docs/next/getting-started`, fetched
2026-08-17), and confirmed `pnpm run build` actually compiles and bundles
the service worker (`✓ (serwist) Bundling the service worker script with
the URL '/sw.js'...`) against Next 15.5.23 with Turbopack/webpack. This is
not a paper evaluation — the build was run and passed.

A hand-rolled service worker was considered and rejected: it would mean
reimplementing precache-manifest generation, cache-busting on deploy, and
navigation preload — solved problems Serwist already handles — for no
functional gain here. Rejected on "boring beats hand-rolled" grounds, not
because hand-rolling is impossible.

Rejected `next-pwa` for the maintenance-status reason above and because
Serwist is what Next.js's own docs now point to.

**Build-time gotcha recorded for future agents:** `app/sw.ts` needs
`lib: ["webworker"]` types (`ServiceWorkerGlobalScope`), which conflicts
with the app's own `lib: ["dom", ...]` tsconfig if merged into one project.
Fixed by excluding `app/sw.ts` from the root `tsconfig.json` and giving it
its own `tsconfig.sw.json` (extends the root config, overrides `lib` and
adds `types: ["@serwist/next/typings"]`) for editor/IDE support. It is not
wired into `pnpm typecheck` — Serwist's own build step (esbuild-based, not
tsc) is what actually compiles it, and `next build` already proved that
step works.

### 2. IndexedDB write queue: `idb`, not Dexie

`idb` (8.0.3) is a ~1KB Promise-based wrapper directly over the native
IndexedDB API — no query layer, no reactivity/observables, no schema DSL.
Dexie (4.4.5) is a much larger, opinionated ORM-like layer with live
queries and its own transaction model.

AGENTS.md's offline design is explicit and narrow: "the sync queue has one
error policy: retry with backoff, then surface visibly to the user" (rule
7) and conflicts resolve "last-write-wins per field with an audit entry,
never silent overwrite of a whole record" (build-spec §2.5). That is a
single append/retry queue with explicit, hand-written conflict logic — not
a general-purpose reactive local database. `idb`'s thin wrapper keeps full
visibility into transaction boundaries, which the capture module needs to
implement that exact retry/backoff/audit behavior without fighting an ORM's
own transaction abstractions. Dexie's extra surface (live queries,
multi-table joins, its own sync-protocol addon) is capability this project
does not need and that AGENTS.md's "no over-engineering" instruction argues
against.

Neither package is installed with any actual queue code yet — that is
`src/core/capture/`'s job, out of scope for this toolchain task. This ADR
only picks and installs the library.

### 3. What iOS Safari actually supports today (verified, not assumed)

**PWA install-to-homescreen:** Works via manual "Add to Home Screen," no
`beforeinstallprompt` event support (that's a Chromium-only API). Standalone
mode strips Safari chrome, uses the manifest's icons/splash config. No
automatic install prompt — the UI has to instruct the user to do this
manually.

**Camera capture:** `getUserMedia` and `<input capture>` both work in
standalone (home-screen-installed) mode on current iOS, but this has been
genuinely fragile across iOS point releases — WebKit bug 185448 tracked
`getUserMedia` not working at all in home-screen-installed apps for years;
more recently, camera access reportedly broke again in iOS 18.0 and was
fixed in 18.1.1. The camera permission decision is also not reliably
persisted across PWA launches the way it is in a normal Safari tab, so
capture UI needs to handle "permission asked again" gracefully, every
session, not just handle the first-run case. **Consequence for the capture
module:** do not assume a single permission grant is durable; design the
capture flow to re-request/re-check camera permission defensively on every
capture screen mount.

**Geolocation API:** Standard `navigator.geolocation` works in Safari and
in standalone PWAs; no iOS-specific gap found in this pass. (Callers still
need HTTPS — non-negotiable per build-spec §2.8 — and an explicit
permission prompt UX.)

**Service worker + Background Sync:** Service workers themselves are
supported. **The Background Sync API (`SyncManager` /
`sync` event) is NOT supported by Safari on iOS, and MDN currently flags
Background Sync as "Limited availability... does not work in some of the
most widely-used browsers"** (a direct, cross-checked signal, not just a
blog claim). This directly affects the sync design: **do not build the
offline sync queue assuming a background sync event will fire when
connectivity returns while the app is closed or backgrounded.** The queue
in `src/core/capture/` must instead sync opportunistically in the
foreground — on app open, on a visible "you're back online" transition
(`navigator.onLine` / `online` event), and via an explicit user-triggered
retry — never relying on a `sync` event that iOS will simply never deliver.
This is the single most consequential platform fact for the M2 capture
module's design and is why it's called out here rather than buried in a
package-choice paragraph.

## Consequences

- `src/core/capture/`'s sync design must be foreground/visibility-driven,
  not Background-Sync-driven. This should be restated in that module's task
  brief so the assigned agent doesn't design against an API iOS silently
  ignores.
- Camera-permission UX in the capture flow needs a defensive
  re-check-every-mount pattern, not a one-time onboarding permission ask.
- `public/manifest.webmanifest` currently ships with an empty `icons: []`
  array — there are no app icon assets in this repo yet. Real icons (in the
  sizes iOS wants for home-screen/splash) are a blocker for actual
  install-to-homescreen testing on a device; noted in the journal.

## Sources (retrieved 2026-08-17)

- Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Serwist Next.js getting-started (exact `withSerwistInit`/`app/sw.ts` code shape): https://serwist.pages.dev/docs/next/getting-started
- Serwist `disable` config option: https://serwist.pages.dev/docs/next/configuring/disable
- WebKit bug tracker, `getUserMedia` not working in standalone/home-screen apps: https://bugs.webkit.org/show_bug.cgi?id=185448
- Apple Developer Forums, iOS 18.1 camera-in-PWA regression: https://developer.apple.com/forums/thread/769203
- Apple Developer Forums, Background Sync support question (community-confirmed absence): https://developer.apple.com/forums/thread/694805
- MDN, Background Synchronization API — "Limited availability" browser-support flag: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
- WebKit standards-positions pointer (WebKit's own feature-status page has been retired in favor of this + MDN + caniuse): https://webkit.org/status/
- PWA iOS limitations survey (secondary, corroborating): https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
