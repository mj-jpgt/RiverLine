# 0003 — Module boundary enforcement

Status: Accepted
Date: 2026-08-17

## Context

AGENTS.md rule 2: "Never edit files outside your assigned module directory
... Cross-module imports fail lint by design." The task brief further
specifies two concrete rules to encode:

1. `src/modules/<x>` may not import from `src/modules/<y>`.
2. Nothing outside `src/core` may import `src/core` internals — only its
   public entry point.

The task asked to evaluate `eslint-plugin-boundaries` against
`dependency-cruiser` and pick one, with an ADR.

## Options considered

**`eslint-plugin-boundaries`** — runs as an ESLint rule inside `pnpm lint`,
so violations show up as regular ESLint errors in-editor and in the same
`eslint .` invocation that already runs `eslint-config-next` and the
project's other lint rules. Supports exactly the two constructs needed:
element types with captured path segments (`src/core/*/**` capturing the
family name) for the "no cross-module import" rule, and a file-path
matcher (`internalPath`/`fileInternalPath`) for the "only via entry point"
rule.

**`dependency-cruiser`** — a separate CLI (`depcruise`) with its own config
file and its own graph/report output, run as an additional `pnpm lint` step
alongside ESLint rather than inside it. Also capable of expressing both
required rules (it has first-class support for "may not depend on" and
path-based rules), and additionally produces dependency graphs, which
`eslint-plugin-boundaries` does not.

## Decision

Picked `eslint-plugin-boundaries`. It is one dependency running inside the
one lint command AGENTS.md already documents (`pnpm lint`), rather than a
second CLI with a second config format and a second report to read.
`dependency-cruiser`'s graph-visualization features are real but unused
here — nothing in this task or in AGENTS.md asks for a dependency graph,
and adding a tool for a feature nobody asked for is exactly what "no
over-engineering" argues against. If a future agent genuinely needs graph
visualization, that's a new, separate ADR with its own justification, not
a reason to run two boundary-enforcement tools at once.

### Implementation notes (for the next agent who touches this)

The plugin has gone through a v5→v6→v7 API migration
(`eslint-plugin-boundaries@7.2.0` is what's installed). The old
`boundaries/element-types` + `boundaries/entry-point` rule pair still
works but is deprecated and prints a wall of migration warnings on every
lint run. This repo uses the current `boundaries/dependencies` rule
instead, configured in `eslint.config.mjs`.

Two non-obvious things were discovered by testing actual violations, not by
reading docs alone (docs proved unreliable/summarized on these details —
see the debug session that follows):

- The element selector key for restricting which file within an element is
  importable is `fileInternalPath` (not `internalPath`, though `internalPath`
  is silently accepted as an alias by the legacy-selector normalizer and
  produces confusing, hard-to-debug non-matches — avoid it).
- `fileInternalPath`'s *value* is the file's path **relative to the
  project root that matched the element pattern**, not relative to the
  captured instance directory. For pattern `src/core/*/**`, the entry-point
  file `src/core/auth/index.ts` has `fileInternalPath: "src/core/auth/index.ts"`
  — a glob like `"src/core/*/index.ts"` is required, not the bare string
  `"index.ts"`.

This was confirmed empirically: `ESLINT_PLUGIN_BOUNDARIES_DEBUG=1 pnpm
exec eslint <file>` prints the full resolved dependency description
(`from`/`to` element objects, including the exact `fileInternalPath`
string the plugin computed) for every import in the file being linted.
Use that env var, not guesswork, if this config needs to change.

The final `boundaries/dependencies` policy set (see `eslint.config.mjs`
for the literal config) was verified against three real test files created
and deleted during this task, not just reasoned about:

1. `app/*` importing a non-`index.ts` file inside `src/core/auth/` →
   **correctly rejected**.
2. `app/*` importing `src/core/auth/index.ts` (the entry point) →
   **correctly allowed**.
3. `src/modules/b/index.ts` importing `src/modules/a` (a different module
   family) → **correctly rejected**.
4. A `src/core` family importing a sibling `src/core` family via that
   sibling's `index.ts` → **correctly allowed** (AGENTS.md only restricts
   *outside-of-core* access to core internals, not core-to-core; same-family
   internal files are never boundary-checked at all, by the plugin's
   `checkInternals: false` default, so files within one core family can
   freely import each other without going through their own `index.ts`).

## Consequences

- Every `src/core/<family>/` module must expose its public surface through
  an `index.ts`. Deep imports from outside that family will fail lint.
- `src/modules/<x>/` families are fully isolated from each other by
  default — even via their own `index.ts`. If two add-on modules genuinely
  need to share code, the answer is to lift that code into `src/shared/`,
  not to add an exception to this rule (which would need its own ADR since
  it changes an AGENTS.md-mandated behavior).
- The local `no-raw-color-or-arbitrary-value` ESLint rule (raw hex colors /
  Tailwind arbitrary values in `src/`) is defined inline in
  `eslint.config.mjs` as a plain rule object, not a separate npm package —
  it's one narrow regex check on `Literal`/`TemplateElement` nodes, and a
  whole plugin dependency for that felt like the over-engineering this
  project explicitly avoids.

## Sources (retrieved 2026-08-17)

- eslint-plugin-boundaries README: https://raw.githubusercontent.com/javierbrea/eslint-plugin-boundaries/master/README.md
- jsboundaries.dev `boundaries/dependencies` rule docs: https://www.jsboundaries.dev/docs/rules/dependencies/
- v5→v6 and v6→v7 migration guides (linked from the deprecation warnings emitted by the installed `eslint-plugin-boundaries@7.2.0` package itself): https://www.jsboundaries.dev/docs/releases/migration-guides/v5-to-v6/ , https://www.jsboundaries.dev/docs/releases/migration-guides/v6-to-v7/
- Primary verification: reading `node_modules/eslint-plugin-boundaries/dist/Rules/Dependencies.js` and `node_modules/.pnpm/@boundaries+elements@3.1.1.../dist/index.js` directly, and running `ESLINT_PLUGIN_BOUNDARIES_DEBUG=1 pnpm exec eslint <file>` against real test imports, since the fetched docs proved insufficiently precise about `fileInternalPath`'s exact value format.
