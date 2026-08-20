# Visual Direction

This is a decision, already made. Agents apply it. Do not re-decide, do not
"improve" it, do not add a flourish because a surface looks plain.

## v2 amendment (2026-08-18, project owner directive via orchestrator)

The owner reviewed the built app and directed an evolution. These points
override anything below that conflicts. Everything not named here stands.

1. Palette: white, blue, gray. Cool near-white surfaces, a strong blue
   accent family, grays for structure. Values still come from real cited
   sources (USWDS grades preferred). No new colors beyond status colors.
2. Identity: the app should read as a flood instrument, not a generic tool.
   A restrained water motif is now permitted on the landing page, the home
   header, and section headers: an animated water line, level gauge, or
   slow current rendered in CSS/SVG/canvas. Subtle, monochrome-blue, never
   busy. NO stock video files, NO emojis anywhere, no illustration packs.
3. Type: replace default-feeling text with a real pairing loaded via
   next/font: Public Sans (UI; USWDS's own face, keeps the institutional
   register) and IBM Plex Mono or equivalent for data/figures. Weights may
   be more confident than v1. Sunlight legibility rules still bind capture.
4. Motion: text and surface entrance transitions are now permitted on
   non-field surfaces (landing, home, dashboard, admin): short fades and
   rises, staggered lists, number count-ups on stats. The `motion` package
   (successor to framer-motion) is APPROVED as a dependency (ADR required).
   Hard limits stand: nothing bouncy or springy-cute, everything under
   ~300ms feel, prefers-reduced-motion kills all of it, and the CAPTURE
   FLOW keeps v1 rules (functional motion only, one decision per screen).
5. Component/pattern sources: take patterns from validated public sources
   (21st.dev, shadcn/ui, USWDS patterns) and log provenance per component
   in the journal. Adapt everything to tokens; never paste a foreign
   aesthetic wholesale. On-theme means: minimal, cool, institutional,
   water-adjacent.
6. The two acceptance questions at the bottom of this file still decide
   every merge. The second one now has teeth: bland is a failure.

## The commitment

**An official instrument, not a product.** RiverLine is used by a municipal
building official to make a legally consequential determination, standing
outside, in glare, on a phone. It should read the way a survey instrument or a
government form reads: plain, high-contrast, unmistakably institutional,
obviously serious. A homeowner who later sees a determination letter generated
by this tool should perceive it as coming from the city, not from a startup.

That commitment does the anti-slop work for free. The default AI aesthetic —
gradients, glass, soft cards, playful motion — is *wrong for this domain*, not
merely overused. Rejecting it is a correctness argument, not a taste argument.

## Anti-goals

Not a SaaS dashboard. Not a consumer app. Not cute, not playful, not
gimmicky. No illustration, no mascots, no decorative imagery, no marketing
surfaces inside the tool. No dark mode in v1 — one theme, tested in sunlight.

**This is not permission to be austere or bare.** "Institutional" describes
the *tone* — plain, serious, high-contrast — not the *craft level*. A well-made
instrument feels solid and satisfying to use: the interaction is immediate,
the motion is clear, nothing feels dead or laggy. That is a requirement, not a
decoration. See "Smooth, not decorative" below — it is equally load-bearing
with the anti-goals above, and an agent that reads only the anti-goals and
ships something bare has failed the brief just as much as one that ships
gradients.

## Smooth, not decorative

The complaint this section exists to prevent: agents that read "no
gradients, no bounce, no glassmorphism" and conclude the safe move is to skip
interaction design entirely, shipping static HTML-looking screens with no
feedback. That is a different failure from slop, and it is just as
unacceptable. Every one of these is required, not optional polish:

1. **Every tap gets a response within one frame.** A pressed state, a color
   shift, something — never a dead half-second where the user doesn't know
   the tap registered.
2. **Screen transitions are quick and directional**, not an abrupt cut and
   not a slow fade. In the capture flow, forward and back should feel like
   moving along a sequence, so the user always knows where they are.
3. **Loading and syncing are calm, not alarming.** A clear, unhurried
   indicator — never a frozen screen, never a jarring spinner that implies
   something is wrong when it isn't.
4. **Typography is confident, not default.** Real weight and size choices
   from the type scale, not browser-default text sitting on a white
   background — that bare look is exactly the "made in raw HTML" feeling to
   avoid, and it comes from *not* applying the token system, not from
   applying it.
5. **Spacing breathes.** Generous, consistent rhythm from the spacing scale.
   Cramped layouts read as unfinished regardless of how correct the colors are.
6. **Errors and empty states are designed, not left blank.** A validation
   error explains what to fix; an empty list explains what will appear there.
   A default browser alert or a blank white area is a failure.
7. **Everything responds smoothly to input** — scrolling, photo capture,
   element-by-element navigation — even on a mid-range iPhone on a slow
   connection. Janky, stuttering interaction reads as broken even when the
   logic underneath is correct.

The test for this section: does it feel like a well-made physical tool —
responsive, clear, satisfying — or does it feel like a form that happens to
render in a browser? The second is a failure even when every anti-goal above
is respected.

## Base system: USWDS

Seed the token layer from the U.S. Web Design System rather than inventing a
palette. Three reasons, in order of importance: its accessibility and
touch-target decisions were made by people who studied government service
delivery; it gives the tool a recognizable public-sector visual language, which
is a credibility asset when pitching a city building department; and adopting an
established system is structurally incompatible with generic AI defaults.

Pull USWDS tokens for color, spacing, and type scale from the official USWDS
documentation and record the exact values in `tokens.css` with a source URL and
retrieval date. **Do not write USWDS hex values or token names from memory** —
look them up, cite them, commit them once. Everything downstream references our
semantic layer, never USWDS internals directly.

## Token layer

`docs/design/tokens.css` is the only place color, spacing, radius, type size,
and elevation are defined. Semantic names only — components reference meaning,
not appearance, so the palette can change in one edit.

```
--color-surface / --color-surface-raised / --color-border
--color-text / --color-text-muted        (muted still meets AA — no thin gray)
--color-action / --color-action-hover / --color-action-pressed
--color-status-not-sd / --color-status-borderline / --color-status-sd
--color-status-draft / --color-danger / --color-focus

--space-1 … --space-8                    (single scale, no arbitrary values)
--radius-sm / --radius-md                (two options; no rounded-full anywhere)
--text-sm / --text-base / --text-lg / --text-xl / --text-2xl
--tap-min: 48px                          (floor for every interactive element)
```

Raw hex, arbitrary Tailwind values, and inline styles fail lint. If a token you
need does not exist, stop and ask — do not inline a value.

## Type

One family for the interface, one for data. Prefer the USWDS default text face
for the interface; use a tabular-figure face or `font-variant-numeric:
tabular-nums` for every number, ratio, currency value, and table column, so
digits align and a 47% never reads as a 41%. Minimum interface size 16px;
capture-flow labels and values considerably larger. No thin or light weights
anywhere — they disappear in sunlight.

## Color and meaning

Color carries status and nothing else. There is no decorative color in this
product.

- **NOT_SD** — green
- **BORDERLINE** — amber (always paired with a "requires review" label)
- **SD** — red
- **Draft / unadopted** — neutral gray

Every status is conveyed by label *and* color, never color alone. A determination
status must be legible in grayscale and to a colorblind user, because it may be
printed.

## Layout

Generous vertical rhythm, single column on mobile, one decision per screen in the
capture flow. Separation comes from spacing and background steps, not from a 1px
border on every element. Dense tables are permitted only in the desktop
administrator dashboard, never in the field flow.

## Motion

Functional only: a state change, a sync indicator, a progress advance. Under
150ms, no easing theatrics, no hover animation. Respect
`prefers-reduced-motion`. If motion is decorative, delete it.

## Print

Determination letters will be printed on a municipal printer and mailed. Design
them print-first: black on white, no background fills, no color-dependent
information, jurisdiction letterhead at top, ordinance citation and appeal
language in body text at readable size. Test on actual paper before shipping.

## The acceptance question

Before any UI merges, two questions, both must pass: **would this look correct
hanging in a city building department, and could an official use it
one-handed, in sunlight, with wet gloves, in under a minute?** And: **does it
feel like a well-made instrument — immediate, clear, satisfying to use — or
does it feel like a bare form rendered in a browser?** A UI that passes the
first question and fails the second is not done.
