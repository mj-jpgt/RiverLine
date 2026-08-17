# 0001 — Toolchain and pinned versions

Status: Accepted
Date: 2026-08-17

## Context

AGENTS.md pins the stack (Node 22 LTS, pnpm 9, Next.js 15 App Router, React
19, TypeScript strict, Postgres 16 + PostGIS, Playwright, Vitest, Python 3.12
in `scripts/preprocess/` only) but not exact patch/minor versions. This is a
greenfield repo — nothing was installed yet. This ADR records what was
actually verified to exist and resolved, as of the retrieval date below, and
why each pin was chosen over the newest thing on npm.

The environment at the start of this task: Node v20.17.0 (not 22 — a hard
mismatch with AGENTS.md), no pnpm, npm 11.17.0, git 2.49.0, Python 3.13.5
(default) and 3.12.10 (also present), Docker 28.5.2 with Compose v2.40.3.

## Options considered

**Node runtime.** `nvm-windows` was already installed
(`C:\Users\mobar\AppData\Local\nvm\nvm.exe`). Installed and switched to Node
22.23.2, the latest 22.x LTS per `nvm list available`. Verified `node -v`
resolves to 22.23.2 in both the bash and PowerShell tool shells (nvm-windows
uses a single machine-wide symlink, so this is consistent across shells).

**Package manager.** `corepack enable && corepack prepare pnpm@9 --activate`
per the task instruction. Resolved to pnpm 9.15.9 — the latest 9.x, and the
major version AGENTS.md pins. (pnpm itself reports 11.22.0 as the latest
overall release; we deliberately stayed on the pinned major.)

**Next.js.** AGENTS.md pins "Next.js 15." The npm `latest` dist-tag for
`next` is 16.3.1 as of the retrieval date — a major version ahead of the
pin. Installed the newest *stable* 15.x instead: 15.5.23 (verified via
`npm view next versions --json`, filtered to non-canary 15.x). Upgrading to
Next 16 is a real decision (breaking changes, App Router behavior) that
needs its own ADR and a human sign-off; out of scope here.

**TypeScript.** `npm view typescript dist-tags` shows `latest: 7.0.2` — this
is the new Go-based TypeScript compiler rewrite. `typescript-eslint@8.67.0`
(the linting stack Next 15's `eslint-config-next` needs) declares a peer
range of `typescript: ">=4.8.4 <6.1.0"` — it does not support TS 7 yet.
Pinned `typescript@6.0.3`, the newest release inside that supported range,
rather than the bleeding-edge `latest` tag, so typecheck and lint don't
silently diverge on which compiler they trust.

**ESLint.** `eslint-config-next@15.5.23`'s peer range is
`eslint: "^7.23.0 || ^8.0.0 || ^9.0.0"` — it does not yet support ESLint 10
(npm `latest` for `eslint` is 10.8.1). Pinned `eslint@9.39.5`, the newest
9.x. Confirmed via `npm view eslint-config-next@15.5.23 peerDependencies`.

**Everything else** — resolved to the newest version on npm with no
conflicting peer constraint found:

| Package | Resolved version | Verified via |
|---|---|---|
| next | 15.5.23 | `npm view next versions --json` |
| react | 19.2.8 | `npm view react version` |
| react-dom | 19.2.8 | `npm view react-dom version` |
| typescript | 6.0.3 | `npm view typescript versions --json` |
| vitest | 4.1.10 | `npm view vitest version` |
| @playwright/test | 1.62.1 | `npm view @playwright/test version` |
| @supabase/supabase-js | 2.112.3 | `npm view @supabase/supabase-js version` (engines: node >=22, matches our pin) |
| tailwindcss | 4.3.3 | `npm view tailwindcss version` |
| zod | 4.4.3 | `npm view zod version` |
| eslint | 9.39.5 | `npm view eslint-config-next@15.5.23 peerDependencies` |
| eslint-config-next | 15.5.23 | `npm view eslint-config-next versions --json` |
| typescript-eslint | 8.67.0 | `npm view typescript-eslint version` |
| eslint-plugin-boundaries | 7.2.0 | see ADR 0003 |
| serwist / @serwist/next | 9.5.12 | see ADR 0002 |
| idb | 8.0.3 | see ADR 0002 |
| pg | 8.23.0 | see ADR 0004 |

## Decision

Pin Node 22.23.2, pnpm 9.15.9, and the version table above. Use the newest
release available within each package's real, verified compatibility
constraints — never the bare npm `latest` tag when a documented peer range
says otherwise.

## Consequences

- `package.json` pins every dependency to an exact version (no `^`/`~`) so
  `pnpm install` is reproducible for the next agent.
- Node 22 is not the machine's prior default; anyone opening a new shell on
  this machine without nvm awareness may get Node 20 again. `engines.node`
  in `package.json` is set to `"22.x"` as a guardrail, but it only warns —
  it does not block installs on an incompatible Node.
- TypeScript 6.0.3 and ESLint 9.39.5 are both one major behind their npm
  `latest` tag. This is intentional and should be revisited (with its own
  ADR) once `typescript-eslint` and `eslint-config-next` ship support for
  TS 7 / ESLint 10.
- Upgrading to Next.js 16 is explicitly deferred, not rejected. It needs its
  own ADR when someone wants to spend time on the breaking-change review.

## OneDrive-synced working directory: recommendation

The repo lives at `C:\Users\mobar\OneDrive\Riverline` — inside a
OneDrive-synced folder. The task brief flagged this as a likely source of
`node_modules` sync churn and file-locking problems, and asked for an
explicit recommendation without unilaterally moving the repo.

**What was actually observed in this session:** `pnpm install` (554
packages, including native builds like `sharp` and `unrs-resolver` that run
postinstall scripts) completed in 22.1 seconds with no lock errors, no
retry warnings, and no corrupted-file symptoms. `next build`, `vitest`,
and `playwright test` (which spawns a real `next dev` server via
`webServer`) all ran cleanly afterward in the same tree. So in this single
session, on this machine, OneDrive did not visibly break anything.

That is weak evidence, not a clean bill of health. The way OneDrive causes
problems for `node_modules` is well-documented but is exactly
sync-timing-dependent and intermittent: `node_modules` is ~530MB across
tens of thousands of small files (verified: `du -sh node_modules`), and
OneDrive's Files On-Demand / real-time sync attempts to hash and upload
every one of them, including ones that get rewritten seconds later by the
next `pnpm install`. The failure mode is EBUSY/EPERM file-lock errors
mid-install or mid-build, or corrupted files if OneDrive uploads a
half-written file — and it tends to show up under load (many small
concurrent writes, several agents running `pnpm install` around the same
time, or a slow/throttled connection), not on a single clean run on an idle
machine.

**Recommendation: do not move the repo, but stop OneDrive from syncing
`node_modules` and other build output.** Two ways to do this, in order of
preference:
1. Right-click `node_modules` (and `.next`, `playwright-report`,
   `test-results`) in File Explorer → "Always keep on this device" is the
   wrong direction; instead use OneDrive Settings → "Backup" →
   exclude these folders, or simpler: since they are already `.gitignore`d
   and regenerated by tooling, this is low-risk to get wrong either way.
2. The much simpler and more robust fix, if problems actually appear: set
   `%NODE_MODULES_ROOT%`-style redirection is not a real Node feature, so
   the practical version is to symlink `node_modules` to a path outside
   OneDrive (e.g. `C:\dev-cache\riverline\node_modules`) after `pnpm
   install`, or set pnpm's virtual store outside OneDrive via
   `.npmrc: store-dir=C:\dev-cache\pnpm-store` (pnpm already
   hardlinks from a central store, so this mainly relocates the store, not
   `node_modules` itself, and further reduces OneDrive's install-time
   churn).

This is a "watch for it" call, not a "move now" call: nothing failed in
this session, the fix if it does start failing is cheap (a symlink or an
`.npmrc` line, not a repo move), and moving a git repo the human is actively
working in has its own cost (path references, IDE re-indexing, any local
scripts pointing at the old path). If OneDrive-related install/build
failures start happening in a future session, that is the trigger to revisit
this — at that point, moving the repo out of OneDrive entirely (with
OneDrive backing up only via a separate, less sync-aggressive mechanism, or
relying on git remotes instead of OneDrive for the actual backup) is the
right call, not a workaround.

## Sources (retrieved 2026-08-17)

- `npm view <pkg> version|versions|dist-tags|peerDependencies|engines --json` — run directly against the public npm registry for every package in the table above.
- `nvm list available` (nvm-windows) for Node LTS line.
- `corepack prepare pnpm@9 --activate` output for resolved pnpm version.
