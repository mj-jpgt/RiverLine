# AGENTS.md — RiverLine SDD

Field tool for local floodplain officials to record flood damage, compute the
FEMA 50% substantial-damage ratio, and issue determination letters.
Output has legal consequences. Correctness beats speed. Ask before guessing.

## Stack (pinned — do not change without an ADR)

- Node 22 LTS, pnpm 9
- Next.js 15 (App Router), React 19, TypeScript strict
- Postgres 16 + PostGIS (Supabase), Row-Level Security on every table
- Playwright for E2E, Vitest for unit
- Python 3.12 used ONLY in `scripts/preprocess/`, never in the serving path

## Commands

```bash
pnpm install
pnpm dev                      # http://localhost:3000
pnpm test:unit --run          # Vitest
pnpm test:e2e                 # Playwright, requires pnpm dev running
pnpm test:offline             # capture flow with network disabled — merge blocker
pnpm lint                     # eslint + boundaries + dependency-cruiser
pnpm typecheck                # tsc --noEmit
pnpm db:migrate               # forward-only migrations
pnpm verify                   # runs all of the above; must pass before any PR
```

## Hard rules

1. `schema/core.sql` is FROZEN. Never edit it. Propose a diff in your PR
   description and stop; a human approves schema changes.
2. Never edit files outside your assigned module directory. Your task states
   your directory. Cross-module imports fail lint by design.
3. No new production dependency without an ADR in `docs/adr/`. Use what is here.
4. Never invent an external fact. Field names, FEMA cost figures, ordinance
   citations, statute numbers, contact names: each must come from a file in
   `docs/data-contracts/` or carry a primary-source URL inline. Facts without
   sources are deleted at review.
5. Never write FEMA unit-cost values from memory. They come only from
   `docs/data-contracts/sde-cost-tables.md`, with page citations.
6. Mock/fixture data lives only in `test/fixtures/` and seeds only databases
   named `*_test`. Never in `src/`, never in a seed script.
7. No empty catch blocks. The sync queue has one error policy: retry with
   backoff, then surface visibly to the user. Silent failure is data loss.
8. Never collect: SSN, bank or card data, insurance policy numbers, phone
   numbers of residents, date of birth. If a task seems to want these, stop
   and ask.
9. Never commit secrets. Env vars only, referenced via `process.env`.
10. `calculations` rows are immutable. A re-run inserts a new row. Never UPDATE.
11. Determinations are never deleted. Status becomes `superseded`.
12. The local official is the decision-maker of record. The system proposes;
    the official adopts. Never auto-adopt a determination in code or copy.

## Offline is a requirement, not a feature

The field capture flow (`src/core/capture/`) must work with the network fully
disabled and sync later. Do not move capture logic into server calls, server
actions, or route handlers. `pnpm test:offline` is a merge blocker.

## Geospatial

All raster and parcel joins happen once, offline, in `scripts/preprocess/`,
producing static tables. The serving path reads rows. It never opens a raster,
never calls GDAL, never does a spatial join at request time.

## UI

Read `docs/design/direction.md` before writing any component. Summary:
institutional government field tool, high contrast, large tap targets, works
in sunlight with wet gloves. Tokens in `docs/design/tokens.css` are the only
source of color, spacing, radius, and type. Raw hex, arbitrary Tailwind values
(`w-[347px]`), and inline styles fail lint.

Every interactive element ships all states: default, hover, active, focus-visible,
disabled, loading, error, empty. A screenshot is not proof it works. A passing
Playwright test that clicks the real control and asserts the real state change is.

## Definition of done

- `pnpm verify` passes
- New behavior has a test that would fail without your change
- Interactive surfaces have a Playwright spec
- Task checklist in `specs/<module>/tasks.md` fully checked
- Appended an entry to `docs/journal/<today>.md`: what you did, what you
  learned, what is still broken

## When blocked

Stop and write the question in your PR description. Do not guess at a schema,
a legal requirement, a cost figure, or a field name. A blocked task returned
with a clear question is a good outcome. An invented answer is not.
