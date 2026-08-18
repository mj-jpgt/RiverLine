# SUBAGENT.md — brief for build agents

Read `AGENTS.md` first. It outranks this file. This file outranks your task
only where they conflict on process; your task defines the work.

You are one of several agents that may be working concurrently. In the current
environment you share ONE working tree (not isolated worktrees — corrected
2026-08-17 after W1 hit a real `.next` collision): stay strictly inside your
assigned paths, `git add` only explicit paths, retry briefly on git index.lock,
never start a server on another agent's port, and treat failures in other
modules' tests during shared runs as not-yours (your own isolated suites must
still pass). Do not otherwise coordinate with other agents.

## Before you write code

1. Read your task block. Identify: your module directory, what you may read,
   the acceptance check, and what is out of scope.
2. Read `schema/core.sql`. It is frozen. Design around it.
3. Read `src/shared/types.ts` for the interfaces you consume and produce.
4. If your task touches external data, read the matching file in
   `docs/data-contracts/`. If there isn't one, **stop and ask** — do not write
   ingest code against a schema you assume exists.
5. State your plan in two or three sentences before implementing. If the plan
   requires touching a file outside your module, stop and ask instead.

## While you work

1. Write the failing test first where the task has a testable acceptance check.
2. Small commits with real messages. `wip` is not a message.
3. Do not add dependencies. If you believe one is required, stop and write the
   case in your PR description; an ADR and a human decision come first.
4. Do not refactor code outside your task's scope, even if it is bad. Note it
   in the journal instead.
5. If something is ambiguous, stop and ask. A blocked task returned with a
   sharp question is a good outcome. A confidently invented answer is the worst
   possible outcome in this project, because the output ends up in a legal letter.

## Never invent

Field names, FEMA unit costs, ordinance citations, statute numbers, deadlines,
agency contacts, CRS classes. Every one of these comes from a committed source
file or carries a primary-source URL inline. If you find yourself producing a
plausible-looking number from memory, that is the signal to stop.

## Before you open a PR

- [ ] `pnpm verify` passes locally
- [ ] New behavior has a test that fails without your change
- [ ] Interactive surfaces have a Playwright spec that clicks the real control
- [ ] No files touched outside your module directory
- [ ] No new dependencies
- [ ] No fixture or mock data outside `test/fixtures/`
- [ ] No secrets, no console noise, no empty catch blocks
- [ ] Task checklist fully checked in `specs/<module>/tasks.md`
- [ ] Journal entry appended: what you did, what you learned, what is broken
- [ ] PR description states: what changed, how you verified it, what you did
      NOT do, and any question you're blocked on

---

# Role: frontend / UI agents

Read `docs/design/direction.md` and `docs/design/tokens.css` before writing a
single component. Everything below is a hard requirement, not a preference.

## Your UI must actually work

You cannot see what you build. Assume it is broken until proven otherwise.

1. **Use the browser.** If Playwright MCP or Chrome DevTools MCP is available,
   open the page, click the controls, screenshot, and iterate. This is the single
   highest-leverage thing you can do; it takes UI debugging from ten round trips
   to two or three.
2. **A screenshot is not proof.** Rendering is not functioning. Proof is a
   Playwright spec that clicks the real control and asserts the real state change,
   passing in CI.
3. **Wire everything.** No `onClick={() => {}}`, no `TODO: connect`, no button
   that renders and does nothing. If you cannot wire it in this task, do not
   render it.
4. **No hardcoded data in `src/`.** If your component needs data you don't have,
   consume the real interface with a loading and empty state, not an array of
   fake rows.
5. **Ship every state.** Default, hover, active/pressed, focus-visible, disabled,
   loading, error, empty. Agents ship the default state and stop; that is the
   most common UI failure in this codebase. Focus-visible is not optional — it is
   how keyboard and screen-reader users operate the tool.
6. **Forms submit, state persists, errors surface.** Test the unhappy path:
   empty submit, invalid input, network failure mid-save.

## Your UI must not look generic

The reason AI-built interfaces look identical is that a model reaches for the
statistical average of every template it has seen, and an average is not a style
— it is the absence of a decision. The decisions are already made in
`docs/design/direction.md`. Apply them; do not re-decide.

**Hard fails. Any one of these and the PR bounces:**

1. Purple→blue or purple→cyan gradients. Any decorative gradient at all.
2. Glassmorphism, blur panels, neon glow.
3. The untouched `rounded-2xl shadow-lg p-6` card.
4. A row of identical cards, each with an icon, a heading, and two lines of text.
5. A colored 3–4px left-border strip on a card or alert. The single most
   reliable AI tell.
6. A flat 1px gray border on everything as the only means of separation.
7. Bounce, scale, or spring animation on hover. This is a field tool used by
   someone standing in mud; motion is for state feedback only.
8. Pure `#fff` / `#000` backgrounds, or raw hex anywhere.
9. Arbitrary Tailwind values (`p-[13px]`, `text-[#3b82f6]`) or inline styles.
10. A timid, even palette with no dominant color and no clear accent.
11. Hand-rolling a component that already exists in the component library.
    Three competing button implementations is how this codebase dies.

**Required instead:** tokens only, from `tokens.css`. Institutional, high-contrast,
plainly-labeled. Type and spacing from the scale. Color carries meaning
(status), never decoration.

**None of the above is permission to ship something bare.** "No gradients, no
bounce, no glassmorphism" does not mean "skip interaction design." Every
interactive surface still needs: an immediate response to every tap (a pressed
state, not a dead half-second), a clear directional transition between capture
screens, a calm and legible loading/syncing indicator, confident type and
spacing from the tokens (not default browser text on white), and designed
error and empty states — never a blank area or a default browser alert. A
static-looking screen that technically avoids every hard-fail but feels like a
bare HTML form is a failure, same as a screen with a gradient card. Read
`docs/design/direction.md` → "Smooth, not decorative" before you build; both
halves of that document are load-bearing.

## Field conditions are the acceptance environment

The user is outdoors, in glare, one-handed, possibly wearing wet gloves,
on a bad connection, on an iPhone.

1. Tap targets ≥ 48px, with ≥ 8px between adjacent targets.
2. Buttons, never sliders, for numeric input. Sliders are unusable with wet hands.
3. One decision per screen. Large type. No dense tables in the capture flow.
4. High contrast throughout — WCAG AA minimum, and prefer well above it. Thin
   gray text is unreadable in sunlight.
5. Never rely on color alone to convey status; pair it with a label or icon.
6. Auto-save on every screen advance. There is no Save button to forget.
7. Offline state is a persistent visible banner, never a silent failure.
8. Every destructive action is confirmable and reversible.

---

# Role: data / backend agents

1. Every query is scoped by `jurisdiction_id` and protected by RLS at the
   database. Application-level filtering is not sufficient and will be rejected.
2. `calculations` are insert-only. `determinations` are never deleted, only
   superseded. Every mutation of a determination writes to `audit_log`.
3. No raster work, no spatial joins, no GDAL in the serving path. That belongs
   in `scripts/preprocess/`.
4. Stamp `cost_table_version` and `engine_version` on every calculation. A
   contested determination must be reproducible exactly.
5. Migrations are forward-only and numbered. Never edit a shipped migration.
6. The sync endpoint must be idempotent — field devices retry.

# Role: test agents

1. You write tests against the **spec**, not against the implementation. A test
   that asserts the code does what the code does is worthless.
2. You do not write or modify the golden fixtures for the 50%-rule engine.
   Those are human-authored from the SDE manual. Implement to them.
3. E2E tests drive real UI controls, not test IDs bolted onto nothing.
4. Include the unhappy paths: offline, mid-sync failure, cross-tenant access
   attempt, borderline ratio routing, override with missing reason.

# Role: research agents

1. Every fact you return carries a primary-source URL and a retrieval date.
2. Prefer primary sources: eCFR, FEMA.gov, USGS, the county GeoHub, the
   jurisdiction's own ordinance. Secondary aggregators are a lead, not a citation.
3. If you cannot verify a fact, say so explicitly. "Not found" is a valid and
   useful answer. A plausible guess is not.
4. Your output goes to `docs/data-contracts/` or `docs/adr/`, never directly
   into product copy or a letter template.
