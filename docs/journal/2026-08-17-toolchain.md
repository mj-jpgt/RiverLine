# 2026-08-17 — Toolchain / backend-foundation agent

## What I did

- Verified the environment before touching anything: Node was v20.17.0
  (not the pinned 22 LTS), no pnpm, npm 11.17.0, git 2.49.0, Python 3.13.5
  default + 3.12.10 also present, Docker 28.5.2 / Compose v2.40.3.
- Installed Node 22.23.2 via the already-present `nvm-windows`, switched to
  it (verified consistent in both bash and PowerShell tool shells), then
  `corepack enable && corepack prepare pnpm@9 --activate` → pnpm 9.15.9.
- Verified every pinned-stack package version against the real npm
  registry (`npm view <pkg> version|versions|dist-tags|peerDependencies`),
  not from memory. Notably: `next`'s npm `latest` tag is 16.3.1 (a major
  ahead of the AGENTS.md pin) — used the newest stable 15.x, 15.5.23,
  instead. `typescript`'s `latest` tag is 7.0.2 (the new Go-based
  compiler) but `typescript-eslint@8.67.0` doesn't support it yet
  (peer range `<6.1.0`) — pinned `typescript@6.0.3`. `eslint-config-next`
  doesn't support ESLint 10 yet — pinned `eslint@9.39.5`. Full table and
  reasoning in `docs/adr/0001-toolchain-and-versions.md`.
- Scaffolded Next.js 15 App Router + TypeScript strict **in place** at the
  repo root (no nested subfolder), preserving all existing content
  (`AGENTS.md`, `CLAUDE.md`, `docs/`, `schema/`, `specs/`, `test/`,
  `data/`, `.gitignore`). Directory skeleton created:
  `src/core/{auth,registry,capture,engine,determination}/`, `src/modules/`,
  `src/shared/` (each with a `.gitkeep` so git tracks the empty dirs).
- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, plus
  the usual strictness knobs (`noUnusedLocals`, `noImplicitOverride`,
  etc). `app/sw.ts` (the service worker) is excluded from it and has its
  own `tsconfig.sw.json` — mixing `dom` and `webworker` lib types in one
  tsconfig doesn't work; see ADR 0002.
- `src/shared/types.ts`: TypeScript interfaces mirroring the table shapes
  literally listed in `docs/riverline-sdd-build-spec.md` §3 ("Data Model"),
  nothing invented beyond that. Every type has a comment pointing at
  `schema/core.sql` as the real source of truth once it exists.
- Installed and wired: Vitest (unit, jsdom environment, `@vitejs/plugin-react`),
  Playwright (E2E, browsers installed via `playwright install --with-deps
  chromium webkit`, projects for both desktop Chrome and iPhone 14 —
  the real deployment target), ESLint 9 flat config (bridged to
  `eslint-config-next` via `FlatCompat` since that package doesn't support
  ESLint 9's native flat config directly yet), `eslint-plugin-boundaries`
  for module-boundary enforcement (see ADR 0003 for the very fiddly
  API-migration details and the empirical debugging that was needed to get
  the entry-point restriction actually working — the docs undersold how
  much trial and error this took).
- `no-empty` with `allowEmptyCatch: false` wired into the lint config. A
  local, dependency-free ESLint rule (`no-raw-color-or-arbitrary-value`,
  defined inline in `eslint.config.mjs`) flags raw hex colors and Tailwind
  arbitrary values (`w-[347px]`) in `src/`.
- `docker-compose.yml`: `postgis/postgis:16-3.4` (tag existence verified
  via `docker manifest inspect` before writing it down). Brought it up in
  this session, confirmed PostGIS 3.4 actually works
  (`SELECT PostGIS_Version()`), not just that the container starts.
- `migrations/` (empty — nothing to migrate yet) + `scripts/db/migrate.mjs`,
  a small boring runner (plain SQL files, `schema_migrations` tracking
  table, transaction-per-file). Ran it against the real local Postgres:
  correctly reports zero pending migrations and exits 0. See ADR 0004 for
  why this was picked over `node-pg-migrate`.
- All promised `pnpm` scripts wired: `dev`, `build`, `start`, `test:unit`,
  `test:e2e`, `test:offline`, `lint`, `typecheck`, `db:migrate`, `verify`.
  `pnpm verify` runs every gate in sequence and prints a PASS/FAIL summary
  table; it does not stop at the first failure, and it exits nonzero if
  anything failed.
- Wrote a toolchain-only smoke test for both Vitest (`test/unit/smoke.test.ts`)
  and Playwright (`test/e2e/smoke.spec.ts`, asserts the real placeholder
  heading renders) — proof the harnesses actually work end to end, not
  just that they're installed.
- Four ADRs written: `docs/adr/0001-toolchain-and-versions.md` (also
  covers the OneDrive/`node_modules` question), `0002-offline-and-pwa.md`,
  `0003-module-boundary-enforcement.md`, `0004-migrations-and-local-db.md`.
  Each cites primary sources with retrieval date 2026-08-17.

## What I verified, not assumed

- Every package version in the table (ADR 0001) via `npm view`.
- Serwist actually compiles against Next 15.5.23 — ran `pnpm build`, saw
  `✓ (serwist) Bundling the service worker script with the URL '/sw.js'`.
- `eslint-plugin-boundaries`'s module-boundary rules actually block the
  right imports and allow the right ones — built three throwaway violation
  files, confirmed each fired or didn't fire as intended, then deleted
  them. The first two config attempts were subtly wrong (deprecated
  `entry-point` rule's `default` scoping was confusing; then the modern
  `dependencies` rule's `fileInternalPath` selector needed empirical
  debugging via `ESLINT_PLUGIN_BOUNDARIES_DEBUG=1` to get the value format
  right). Full story in ADR 0003.
- The local raw-hex/arbitrary-Tailwind-value lint rule actually fires on
  `text-[#3b82f6]`, `#fff`, and `w-[347px]` test strings (and deleted the
  test file afterward).
- `docker manifest inspect postgis/postgis:16-3.4` before writing it into
  `docker-compose.yml`. Then actually started the container and ran
  `SELECT PostGIS_Version()` against it.
- iOS Safari's real, current support for PWA install, camera capture,
  Geolocation, service workers, and — critically — Background Sync (NOT
  supported; MDN flags it "Limited availability"). This directly changes
  how the capture module's sync design has to work: foreground/visibility-
  triggered, never assuming a background `sync` event will fire. Full
  citations in ADR 0002.
- Ran `pnpm run verify` for real, twice. First run failed on `lint`
  (`next-env.d.ts`, regenerated by `next build` with a typed-routes
  triple-slash reference, tripped `@typescript-eslint/triple-slash-reference`
  — fixed by adding `next-env.d.ts` to the ESLint ignore list, which is
  standard practice for a generated file) and `test:offline` (intentional
  blocker, see below). Second run: `typecheck` PASS, `lint` PASS,
  `test:unit` PASS, `test:e2e` PASS (both chromium and mobile-safari
  projects), `test:offline` FAIL — exactly the expected state for a
  greenfield repo with no capture flow built yet.

## What failed / had to be worked around

- Node 20 → 22 mismatch at task start (see "still blocked" — not actually
  blocked, just fixed, but recording it since it's the kind of thing that
  silently breaks things if missed).
- `typescript`'s and `eslint`'s npm `latest` tags are both ahead of what
  the rest of the toolchain (`typescript-eslint`, `eslint-config-next`)
  actually supports. Had to read peer-dependency ranges and pick the
  newest *compatible* version instead of blindly taking `latest`.
- `eslint-plugin-boundaries`'s legacy `element-types`/`entry-point` rule
  pair technically still works but produces a wall of deprecation warnings
  and, worse, its `entry-point` rule's `default` option didn't compose the
  way the (AI-summarized) docs suggested — setting `default: "allow"` to
  scope the restriction to just `core` targets instead disabled the
  restriction entirely for reasons that only became clear from reading the
  plugin's own source and running it with `ESLINT_PLUGIN_BOUNDARIES_DEBUG=1`.
  Migrated to the modern `boundaries/dependencies` rule instead, which
  behaves correctly once the `fileInternalPath` value format (full
  project-relative path, not a path relative to the captured element
  instance) was understood empirically. Full account in ADR 0003 for the
  next person who touches this config.
- `next-env.d.ts` needed to be hand-authored once (standard Next.js
  boilerplate) so `tsc --noEmit` could run before ever running `next dev`
  — normally Next.js generates this file itself. Also needed a
  `global.d.ts` with `declare module "*.css";` — raw `tsc --noEmit` (not
  routed through Next's own type-checking pipeline) doesn't otherwise know
  how to type a bare `import "./globals.css"` side-effect import in
  `app/layout.tsx`. Both are one-time, standard fixes, not ongoing issues.
- Docker Desktop was not running at task start; had to be started
  (`Start-Process "Docker Desktop.exe"`) and waited on before
  `docker compose up` would work. Worth knowing if a future agent hits the
  same "cannot connect to the Docker daemon" error cold.

## What is still blocked

- **`schema/core.sql` does not exist.** This is explicitly a human-owned,
  frozen artifact (AGENTS.md rule 1) and out of scope for this task, but
  it is the actual blocker for everything downstream: `migrations/` is
  empty, `src/shared/types.ts` is a hand-mirrored placeholder rather than
  a generated contract, and no core module (`auth`, `registry`, `capture`,
  `engine`, `determination`) can be implemented against a real schema yet.
- **`pnpm test:offline` fails by design** — there is no capture flow
  (`src/core/capture/`) to test with the network disabled. The script
  (`scripts/test-offline.mjs`) exits nonzero with a clear message rather
  than faking a pass; do not remove that failure without replacing it with
  a real offline E2E test once M2 (field capture) exists.
- **No app icon assets.** `public/manifest.webmanifest` ships with
  `icons: []`. Real install-to-homescreen testing on an actual iPhone
  needs real icon files in the sizes iOS wants; none exist in this repo.
  Not fabricated here since that would be inventing an asset, not a fact,
  but flagging it because it will block real device testing.
- **Node 22 is not this machine's OS-level default** — it was switched via
  `nvm-windows` for this session. A future shell/agent that doesn't know
  to run `nvm use 22.23.2` (or doesn't have nvm-windows at all) could
  silently end up back on Node 20. `package.json`'s `engines.node: "22.x"`
  only warns, it doesn't block.
- **OneDrive-synced repo location**: not observed to cause problems in this
  session (`pnpm install`, `next build`, Playwright browser install/tests
  all ran clean), but this is weak evidence given OneDrive sync issues are
  timing/load-dependent, not deterministic. Recommendation (not a move):
  keep `node_modules` etc. out of OneDrive's sync scope, or relocate
  pnpm's store via `.npmrc` if problems actually start appearing. Full
  reasoning in ADR 0001.
- **Local Postgres+PostGIS container is currently running** (started this
  session via `docker compose up -d db` for verification) — left running
  since it's useful for the next agent, but flagging it so nobody is
  surprised port 5432 is occupied.
