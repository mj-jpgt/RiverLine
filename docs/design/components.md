# Component Foundation

This is the contract every future UI agent builds against. It does not
contain component code — see `docs/design/direction.md` (the decision) and
`docs/design/tokens.css` (the values). This file says: which components the
MVP needs, what shadcn/ui gives us, how we reskin it, and what must never
ship.

Scope: MVP only — M0–M4 core + A1 (letters), A2 (dashboard), A3 (SDE export).
Do not add components for A4–A8; they are post-MVP per the build spec.

---

## 1. shadcn/ui + React 19 + Next.js 15 + Tailwind — compatibility verdict

Checked against the official docs, retrieval date 2026-08-17:
- https://ui.shadcn.com/docs/react-19
- https://ui.shadcn.com/docs/tailwind-v4

**Verdict: compatible, low friction, proceed.**

- shadcn/ui has "full support for React 19 and Tailwind v4 in the `latest`
  release" (their words). AGENTS.md pins Node 22 / pnpm 9 / Next.js 15 /
  React 19 — this is exactly the target shadcn now builds for.
- The only friction point the docs call out is **npm peer-dependency
  conflicts** on some transitive packages that haven't declared React 19 as
  a supported peer yet (recharts is named explicitly, requiring a
  `package.json` override for its `react-is` dependency). **This project
  uses pnpm**, and shadcn's own docs state pnpm/yarn/bun "handle the
  situation with silent warnings" — no `--force` / `--legacy-peer-deps`
  flag needed. This is a non-issue for us as long as no agent switches to
  npm.
- Components were updated for React 19: `forwardRef` usage was removed
  (React 19 no longer requires it) and every primitive now carries a
  `data-slot` attribute for styling hooks. No code in this repo depends on
  the old `forwardRef` pattern, so this is not a migration concern here —
  it only matters to whoever installs components.
- **Tailwind v3 vs v4**: shadcn supports both. New shadcn projects default
  to Tailwind v4, which changed the theming mechanism (see §2). Tailwind
  version is **not currently pinned** in `AGENTS.md`'s stack table — that
  is a gap for the implementing agent to raise, not something this task
  decides. This document assumes Tailwind v4 because it's the current
  shadcn default for new projects and because v4's `@theme` mechanism maps
  onto our semantic tokens more directly than v3's `tailwind.config.js`
  color extension did (see below). If the project pins Tailwind v3 instead
  in an ADR, the mapping in §2 still holds — only the CSS syntax
  (`@theme` block vs. `theme.extend.colors` in config) changes, not the
  token names or values.
- **Honest gap**: this task did not install shadcn or generate a
  `components.json` — that is implementation, out of scope here (see
  CONSTRAINTS). The compatibility verdict is a documentation-verified
  claim, not a locally-tested one. The first agent to actually run
  `npx shadcn@latest init` should confirm the CLI behaves as documented
  before building on top of it, and report back if it doesn't.

---

## 2. Reskinning shadcn to the token layer

shadcn ships zero visual opinion of its own at the component-code level —
its default look comes entirely from the CSS variables its starter theme
defines (the "New York" style, gray/slate palette, `rounded-lg` radii,
`shadow-sm` elevation). That default look is exactly the generic aesthetic
`SUBAGENT.md` hard-fails (rounded-2xl cards, shadow-lg, a timid even
palette). Reskinning means: **shadcn's theme CSS variables must resolve to
our tokens, not to shadcn's stock palette, and several stock defaults must
be overridden or deleted outright.**

Tailwind v4 + shadcn define theme variables in an `@theme inline` block
(see `ui.shadcn.com/docs/tailwind-v4`) that Tailwind turns into utility
classes (`bg-background`, `text-foreground`, `rounded-lg`, etc.). The
mapping below is what the implementing agent wires up — **shadcn variable
on the left, our semantic token on the right.** Nothing here invents a new
color; every right-hand value already exists in `tokens.css`.

| shadcn / Tailwind theme variable | Maps to our token | Note |
|---|---|---|
| `--background` | `var(--color-surface)` | app background |
| `--card` | `var(--color-surface-raised)` | raised surfaces only |
| `--popover` | `var(--color-surface-raised)` | |
| `--foreground` | `var(--color-text)` | |
| `--card-foreground` | `var(--color-text)` | |
| `--popover-foreground` | `var(--color-text)` | |
| `--muted` | `var(--color-surface)` | shadcn conflates "muted background" and "muted text" — we do not; see next row |
| `--muted-foreground` | `var(--color-text-muted)` | |
| `--primary` | `var(--color-action)` | |
| `--primary-foreground` | `#ffffff` | verified 6.72–13.60:1 against all three action fills, see tokens.css |
| `--secondary` | `var(--color-surface-raised)` with `var(--color-border)` outline | shadcn's stock "secondary" (light-gray fill button) reads as decorative; we use it only for the outline/ghost button variant, never a second brand color |
| `--accent` | **do not use** | shadcn uses `--accent` for hover backgrounds on menu-style components (dropdowns, command palettes). We have none in the MVP inventory (§3). If a future component needs a hover background, it is `var(--color-surface)` under a raised card, not a new accent hue. |
| `--destructive` | `var(--color-danger)` | |
| `--destructive-foreground` | `#ffffff` | |
| `--border` | `var(--color-border)` | |
| `--input` | `var(--color-border)` | input field borders, not a separate lighter gray |
| `--ring` (focus ring) | `var(--color-focus)` | never delete or dim this — focus-visible is a hard requirement, SUBAGENT.md §"Ship every state" |
| `--radius` | `var(--radius-md)` for cards/inputs/buttons; `var(--radius-sm)` for small chips/badges | shadcn's stock `--radius: 0.625rem` (10px) with `rounded-lg`/`rounded-xl` derived classes is deleted; **no `rounded-full` anywhere** — badges use `--radius-sm`, never a pill |
| Status/success/warning colors | shadcn/Tailwind has no built-in status palette | wire directly to `--color-status-not-sd` / `-borderline` / `-sd` / `-draft` on the specific status-badge component only; never introduce a generic "green button" |

Additional overrides beyond variable remapping:
- **Shadows**: shadcn's card/dialog defaults use `shadow-sm`/`shadow-lg`
  (soft drop shadows). Direction.md requires separation "from spacing and
  background steps, not from a 1px border on every element" and
  explicitly hard-fails the untouched `rounded-2xl shadow-lg p-6` card.
  Raised surfaces (`--color-surface-raised` on `--color-surface`) get their
  separation from that background-color step, not from a shadow. If a
  component needs elevation (e.g. a modal over content), use a single flat
  `--color-border` outline, not a blurred shadow.
- **Typography**: shadcn's default font stack (`font-sans` → system UI
  stack) is replaced with `var(--font-ui)`; anywhere shadcn renders a
  numeric value (table cells, calculated totals) gets `var(--font-data)`
  or `font-variant-numeric: tabular-nums`.
- **Motion**: shadcn/Radix components ship default open/close transitions
  (fade + slight scale, ~150–200ms, `ease-in-out`). Per direction.md →
  "Motion", anything decorative is deleted; anything functional (a
  dialog opening, a sheet sliding in for the capture-flow "next screen"
  transition) is kept but capped under 150ms with no scale/bounce, and
  gated behind `prefers-reduced-motion`.
- **Button component**: shadcn's default button variants
  (`default`/`secondary`/`outline`/`ghost`/`link`/`destructive`) map onto
  our two real variants — **primary action** (`--color-action` family) and
  **destructive** (`--color-danger`) — plus an outline variant for
  secondary actions. `ghost` and `link` variants are not part of the field
  capture flow (no low-contrast text-only tap targets in sunlight) but may
  remain available for the desktop dashboard where mouse precision exists.

---

## 3. Component inventory (MVP only)

Every entry lists required states per `SUBAGENT.md` → "Ship every state":
default, hover, active/pressed, focus-visible, disabled, loading, error,
empty (where applicable to that component type — e.g. a button has no
"empty" state, a list does).

### Capture flow (M2) — mobile, one decision per screen, offline-capable

| Component | Where used | Required states | Tap target | Field-condition constraint |
|---|---|---|---|---|
| **Structure search field + result list** | Assessor picks a structure by address/GPS-nearest | default, focus-visible, loading (searching), empty (no results — explains what to do next, e.g. "Not finding it? Enter GPS coordinates manually"), error (search failed) | ≥48px per result row, ≥8px gap | List rows, not a map, per build spec §5.1 ("no map required") |
| **Damage-percentage selector** | One per assessment element (11 elements) | default, active/selected, focus-visible, disabled (element not yet reached) | ≥48px per button, ≥8px gap | **Large preset buttons only: 0/10/25/50/75/100, plus a clearly separate "enter exact %" free-entry field. NEVER a slider** (SUBAGENT.md, build spec §6.1) |
| **Progress indicator** | Top of every capture screen ("Element 6 of 11") | default only (non-interactive) | n/a | Must be visible without scrolling; large type per direction.md → Type |
| **Photo capture control** | Per-element photo + required exterior shot | default, capturing (camera active), captured (thumbnail + retake), error (capture failed / storage full), loading (upload in queue) | ≥48px shutter/retake targets | Client-side compression before upload (build spec §11.8); retake must be one tap, not a menu |
| **Next / Back navigation** | Every capture screen | default, hover (desktop only), active/pressed (visible within one frame — direction.md "Smooth, not decorative" #1), focus-visible, disabled (validation incomplete), loading (auto-saving) | ≥48px, full-width or thumb-reachable | Directional transition between screens per direction.md — forward and back read as movement along a sequence |
| **Offline banner** | Persistent, all capture screens when offline | default (offline, shows queued count e.g. "Offline — 3 assessments queued"), transitioning (syncing), success (synced, auto-dismiss) | n/a (banner, not tappable in default state) | **Persistent visible banner, never a toast, never silent** (AGENTS.md hard rule #7, build spec §6.2) |
| **Numeric text input** | Market value override, water depth, notes-adjacent numbers | default, focus-visible, disabled, error (inline, explains what to fix), filled | ≥48px height | `var(--font-data)` / tabular-nums; large type |
| **Attribute selector (occupancy/foundation/stories)** | Structure attribute entry when missing from parcel data | default, selected, focus-visible, disabled, loading (parcel prefill pending) | ≥48px per option | Button group like damage-% selector when the option set is short (≤6); never a slider |
| **Textarea** | Assessment notes | default, focus-visible, disabled, error, filled | ≥48px min-height | |

### Official review (M4) — desktop-friendly but responsive

| Component | Where used | Required states | Tap target | Field-condition constraint |
|---|---|---|---|---|
| **Review queue list/table** | Official's landing screen, borderline-first sort | default, loading, empty ("No assessments awaiting review — designed, not blank", direction.md → "Smooth, not decorative" #6), error | ≥48px row height on touch, denser on desktop pointer input allowed | Sort indicator must be visible, not color-only |
| **Status badge** | Every list row, review screen, dashboard, letters | default only per status (NOT_SD/BORDERLINE/SD/Draft) — no hover/press, it's not interactive | n/a | **Label + color, never color alone** (AGENTS.md, direction.md → "Color and meaning"); must survive grayscale print — this is the component that gets tested on an actual printer |
| **Element override control** | Official overrides a damage-% or value | default, editing, focus-visible, disabled (no reason entered), error (reason required — build spec §5.6) | ≥48px | Override reason is mandatory and audited; the control must not submit without it |
| **Photo side-by-side panel** | Review screen shows every input + photos | default, loading (photos fetching), empty (no photo for this element — flag, don't hide) | n/a | |
| **Adopt / Override / Return action bar** | Bottom of review screen | default, focus-visible, disabled (until required fields complete), loading (submitting), confirmed | ≥48px each, ≥8px gap | Adoption is an explicit signed action, never auto-adopt (AGENTS.md hard rule #12) — requires a confirmation step, not a single accidental tap |
| **Confirmation dialog** | Adopt, override, any destructive/legally-consequential action | default, focus-visible (on primary action), loading, error | ≥48px buttons | Confirmable and reversible per SUBAGENT.md field-conditions #8 where the underlying action allows it (adoption itself is not reversible — the dialog copy must say so plainly, not softened) |

### Dashboard (A2) — desktop administrator, dense tables permitted here only

| Component | Where used | Required states | Tap target | Field-condition constraint |
|---|---|---|---|---|
| **Caseload table** | Main dashboard view | default, loading, empty (no cases yet — explains what populates it), error | Desktop pointer sizing acceptable; still ≥48px if the dashboard is opened on a tablet | Dense tables permitted ONLY here, never in capture flow (direction.md → Layout) |
| **List/Map view toggle** | Dashboard header | default, active (selected view), focus-visible, disabled (map unavailable offline) | ≥48px | MapLibre GL confined to this add-on only — capture flow must never depend on it (build spec §2.1) |
| **CSV export button** | Dashboard header, always available | default, hover, active/pressed, loading (generating), success/error | ≥48px | "Officials live in Excel; meet them there" — must always be present, not buried |
| **Map marker + popup** | Map view | default, hover (desktop), selected, focus-visible (keyboard nav across markers) | popup dismiss target ≥48px | Marker color still needs a non-color cue (shape/label) at the info-panel level once selected |

### Letters (A1) — print-first, minimal interactivity

| Component | Where used | Required states | Tap target | Field-condition constraint |
|---|---|---|---|---|
| **Letter preview / print layout** | Generated after adoption | default (rendered), loading (PDF generating), error (generation failed) | n/a — this is a document, not a control | Print-first: black on white, no background fills, no color-dependent information, jurisdiction letterhead at top, ordinance citation + appeal language in body text (direction.md → Print). This is explicitly NOT a themed UI surface — tokens.css colors do not apply to the letter body except black text on white paper. |
| **Generate / Re-issue letter button** | Determination record screen | default, focus-visible, disabled (determination not yet adopted), loading | ≥48px | Never auto-generate on adoption without an explicit action |

---

## 4. Components that must NOT exist

Direct enumeration of `SUBAGENT.md`'s hard-fails, made concrete for this
inventory. Any PR containing one of these bounces, no exceptions:

1. **No decorative cards.** Nothing here uses a `rounded-2xl shadow-lg p-6`
   card as a container for content that doesn't need a card (e.g. don't
   wrap each assessment element in its own shadowed card — use spacing and
   background-color steps between elements instead).
2. **No icon-heading-two-line card rows.** The structure search results,
   the review queue, and the dashboard caseload list are text-forward rows
   with a status badge — not icon-topped summary cards.
3. **No colored left-border-strip alerts.** The offline banner, validation
   errors, and empty states use full-surface background-color steps or an
   icon + label, never a 3–4px colored strip down one edge.
4. **No sliders for any numeric input**, anywhere — not damage percentage,
   not water depth, not market value. Buttons with presets + a free-entry
   field, every time.
5. **No `rounded-full` badges/pills.** Status badges use `--radius-sm`.
6. **No generic "muted gray card" dropdown/select for damage percentage or
   attribute entry** where a button group fits (≤6 options) — dropdowns
   are reserved for genuinely long option lists (if any ever appear) and
   are not part of this MVP inventory.
7. **No toast notifications for offline/sync state.** That state is
   always the persistent banner, never an auto-dismissing corner toast.
8. **No hover-only affordances anywhere in the capture flow or review
   screen.** These are touch-first, glove-first surfaces; every
   interactive element must be legible and tappable without a hover
   state existing at all.
9. **No icon-only buttons without an accessible label**, in the capture
   flow or review screen — field conditions (glare, gloves, urgency) rule
   out iconography as the sole cue, and SUBAGENT.md requires status to
   never rely on color/icon alone.
10. **No third, competing button/badge/input implementation.** If a
    component in this table already exists, reuse it — hand-rolling a
    parallel one is an explicit hard-fail (SUBAGENT.md #11).
