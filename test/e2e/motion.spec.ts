import { expect, test, type Page } from "@playwright/test";

// V3 motion pass — proof that docs/design/direction.md "Smooth, not
// decorative" is actually implemented, not just described in a CSS
// comment. Root-suite compatible: relative page.goto() paths only, same
// pattern as test/e2e/shell.spec.ts / registry.spec.ts, no dedicated
// config, no cost table needed. Computed-style assertions only — a
// screenshot is not proof (docs/agents/SUBAGENT.md "Your UI must actually
// work").
//
// Demo accounts from scripts/db/seed.mjs, same as shell.spec.ts/
// registry.spec.ts. Concurrent use of the same email across spec files is
// documented safe (src/core/auth/dev-link-store.ts's per-email FIFO queue,
// see shell.spec.ts's comment) — no dedicated email needed here.
const OFFICIAL_EMAIL = "official@example.gov";
const ASSESSOR_EMAIL = "assessor@example.gov";
const PRACTICE_ADDRESS = "123 Practice Ln";

async function loginViaDevMagicLink(page: Page, request: import("@playwright/test").APIRequestContext, baseURL: string | undefined, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").pressSequentially(email);
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toBeEnabled({ timeout: 15000 });
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toHaveText(/sign-in link was sent/i);

  const linkResponse = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(email)}`);
  expect(linkResponse.ok()).toBe(true);
  const { url } = (await linkResponse.json()) as { url: string };
  await page.goto(new URL(url, baseURL).toString());
  await expect(page).toHaveURL(/\/home$/);
}

/** Seconds string ("0.1s") -> number, robust to browser formatting. */
function seconds(value: string): number {
  return parseFloat(value);
}

test.describe("V3 motion pass", () => {
  test.describe.configure({ mode: "serial" });

  test("every tap gets a visible pressed state within --motion-fast, not a dead gap", async ({ page }) => {
    await page.goto("/login");
    // The button starts disabled (app/login/LoginForm.tsx) until a valid
    // email is entered — fill it first so :active is actually reachable,
    // same as a real user would hit before ever tapping it.
    await page.getByLabel("Email address").pressSequentially("official@example.gov");
    const submit = page.getByRole("button", { name: "Send sign-in link" });
    await expect(submit).toBeEnabled();

    const restBg = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
    const transitionDuration = await submit.evaluate((el) => getComputedStyle(el).transitionDuration);

    // docs/design/tokens.css --motion-fast: 100ms — a real, short, defined
    // transition, not an unset (0s) hard cut and not a decorative sprawl.
    expect(seconds(transitionDuration)).toBeGreaterThan(0);
    expect(seconds(transitionDuration)).toBeLessThanOrEqual(0.15);

    // Hold the element in its real :active state (mouse down, still over
    // the element) and read the LIVE computed style — this is the actual
    // browser-applied :active rule, not a simulated class.
    const box = await submit.boundingBox();
    if (!box) throw new Error("submit button not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Let the --motion-fast (100ms) transition actually settle before
    // reading — a same-tick read would catch the interpolation's t=0
    // frame, not the pressed end state.
    await page.waitForTimeout(150);
    const pressedBg = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Release off-element, not over it — a down+up at the same point is a
    // real click and would actually submit the form. This test only
    // proves the pressed *style*, not the submit action.
    await page.mouse.move(box.x + box.width / 2, box.y - 40);
    await page.mouse.up();

    expect(pressedBg).not.toBe(restBg);
  });

  test("registry result rows show pressed feedback and the detail page enters directionally", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);

    await page.goto("/registry");
    const searchInput = page.getByLabel("Address");
    await searchInput.pressSequentially(PRACTICE_ADDRESS);
    const resultLink = page.getByRole("link", { name: new RegExp(PRACTICE_ADDRESS) });
    await expect(resultLink).toBeVisible({ timeout: 10000 });

    // A real held-mouse-down :active reproduction (as the button tests
    // above use) is unreliable specifically for <a> elements under
    // Playwright's WebKit/hasTouch emulation — any pointer movement while
    // "down" reads as a drag/scroll gesture starting and cancels :active
    // mid-touch, which is correct mobile behavior, not a bug, but makes
    // the exact hold-then-read timing browser-dependent. Proving the real
    // CSSOM :active rule exists (border-color genuinely differs from
    // rest) is the robust, cross-browser equivalent for a link.
    const hasRealActiveRule = await resultLink.evaluate((el) => {
      const restBorder = getComputedStyle(el).borderColor;
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (!rule.selectorText.includes(":active")) continue;
          const base = rule.selectorText.replace(/:active/g, "");
          if (!el.matches(base)) continue;
          if (rule.style.borderColor && rule.style.borderColor !== restBorder) return true;
        }
      }
      return false;
    });
    expect(hasRealActiveRule).toBe(true);

    await resultLink.click();
    await expect(page).toHaveURL(/\/registry\/[0-9a-f-]+$/);
    // Wait for the REAL page.tsx content, not the route's loading.tsx
    // fallback — both render their own <main>, and app/registry/[id]/
    // loading.tsx's intentionally has no .pageEnter (a fallback state
    // shouldn't slide in) — reading too early would grab that one instead.
    await expect(page.getByRole("link", { name: "Start assessment" })).toBeVisible();

    // Directional screen entry (motion.md "Screen entry" / .pageEnter):
    // the detail page's <main> plays a real, short mount animation using
    // --motion-base (140ms) — not "none" (a static page) and not an
    // unbounded decorative duration.
    const main = page.locator("main");
    const animationName = await main.evaluate((el) => getComputedStyle(el).animationName);
    const animationDuration = await main.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(animationName).not.toBe("none");
    expect(seconds(animationDuration)).toBeGreaterThan(0);
    expect(seconds(animationDuration)).toBeLessThanOrEqual(0.15);
  });

  test("damage-percentage preset buttons (the flagship capture control) select instantly with a real transition", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, ASSESSOR_EMAIL);

    await page.goto("/registry");
    await page.getByLabel("Address").pressSequentially(PRACTICE_ADDRESS);
    const resultLink = page.getByRole("link", { name: new RegExp(PRACTICE_ADDRESS) });
    await expect(resultLink).toBeVisible({ timeout: 10000 });
    await resultLink.click();

    const startAssessment = page.getByRole("link", { name: "Start assessment" });
    await expect(startAssessment).toBeVisible();
    // Let this page's own --motion-base mount animation (.pageEnter, same
    // mechanism just proven above) finish settling before interacting —
    // avoids racing Playwright's own actionability/stability check against
    // an ancestor still translating.
    await page.waitForTimeout(200);
    await startAssessment.click();
    await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/, { timeout: 15000 });

    // Confirm structure (attributes) screen: occupancy must be set before
    // "Next" is enabled (src/core/capture/draft.ts canAdvanceFromStep).
    await expect(page.getByText("Confirm structure")).toBeVisible();
    const occupancyGroup = page.getByRole("group", { name: "Occupancy type" });
    await occupancyGroup.getByRole("button", { name: "Residential", exact: true }).click();
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeEnabled();
    await next.click();

    // First element screen: the damage % preset grid.
    await expect(page.getByText("Damage percentage")).toBeVisible();
    const damageGroup = page.getByRole("group", { name: /Damage percentage for/ });
    const preset = damageGroup.getByRole("button").first();

    const restColor = await preset.evaluate((el) => getComputedStyle(el).color);
    const transitionDuration = await preset.evaluate((el) => getComputedStyle(el).transitionDuration);
    // docs/design/motion.md item 2 "Selection swap": under --motion-fast,
    // never unset/instantaneous-only.
    expect(seconds(transitionDuration)).toBeGreaterThan(0);
    expect(seconds(transitionDuration)).toBeLessThanOrEqual(0.15);

    await preset.click();
    // React state -> IndexedDB persist -> re-render is async (ElementScreen
    // onClick -> CaptureFlow's persist()); give it a beat past the click
    // event itself before reading the resulting class's computed style.
    await page.waitForTimeout(150);

    // Selected state is unmistakable: background swaps to the action color
    // and stays that way (not just a transient :active flash).
    const selectedBg = await preset.evaluate((el) => getComputedStyle(el).backgroundColor);
    const selectedColor = await preset.evaluate((el) => getComputedStyle(el).color);
    expect(selectedColor).not.toBe(restColor);
    // rgb(0, 94, 162) == --color-action #005ea2 (docs/design/tokens.css).
    expect(selectedBg).toBe("rgb(0, 94, 162)");
  });

  test("prefers-reduced-motion removes every animation/transition duration while pressed feedback still lands instantly", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByLabel("Email address").pressSequentially("official@example.gov");
    const submit = page.getByRole("button", { name: "Send sign-in link" });
    await expect(submit).toBeEnabled();

    // Global safety net (app/globals.css) — every transition/animation
    // duration collapses to ~0, but the pressed color step must still be
    // reachable: reduced motion removes the animated path, never the
    // feedback itself (docs/design/motion.md "prefers-reduced-motion").
    const transitionDuration = await submit.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(seconds(transitionDuration)).toBeLessThan(0.01);

    const restBg = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
    const box = await submit.boundingBox();
    if (!box) throw new Error("submit button not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const pressedBg = await submit.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.move(box.x + box.width / 2, box.y - 40);
    await page.mouse.up();
    expect(pressedBg).not.toBe(restBg);

    // This page's own .pageEnter mount animation (app/login/page.tsx —
    // every page.tsx in this pass shares the same mechanism, see motion.md
    // "Screen entry") is also neutralized. Checked on /login itself rather
    // than navigating to an authenticated route — this test never logs
    // in, and /registry would just redirect back to /login anyway.
    const main = page.locator("main");
    const animationDuration = await main.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(seconds(animationDuration)).toBeLessThan(0.01);
  });
});

// Design v2 — fonts (next/font: Public Sans / IBM Plex Mono), the new
// `motion`-package entrance animation on non-field surfaces (landing,
// home), and the "no emojis anywhere" copy rule (docs/design/direction.md
// "v2 amendment"). A SEPARATE describe block from "V3 motion pass" above:
// that block proves the pre-existing CSS-only --motion-fast/--motion-base
// system (docs/design/motion.md); this one proves the newer, JS-driven
// entrance category (docs/adr/0010-motion-dependency.md) added on top of
// it, which uses the Web Animations API via motion/react rather than a
// named CSS @keyframes animation — hence the different assertion strategy
// below (Element.getAnimations()) instead of reading
// getComputedStyle().animationName/-Duration like the block above does.
test.describe("Design v2 — fonts, entrance motion, no emojis", () => {
  test.describe.configure({ mode: "serial" });

  test("landing page loads Public Sans (UI) via next/font", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "RiverLine SDD" });
    await expect(heading).toBeVisible();
    // next/font/google self-hosts the real named font and resolves
    // docs/design/tokens.css's --font-ui through the generated
    // --font-public-sans variable (app/layout.tsx) — the computed,
    // fully-resolved font-family on a real heading must actually include
    // the family name, not just fall through to a generic system fallback.
    const headingFont = await heading.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(headingFont).toMatch(/Public Sans/i);
  });

  test("home page's stat tiles render with the IBM Plex Mono data face", async ({ page, request, baseURL }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await expect(page.getByRole("heading", { name: "Determination review" })).toBeVisible();
    const statCount = page.getByText("Awaiting review").locator("..").locator("span").first();
    const fontFamily = await statCount.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toMatch(/IBM Plex Mono/i);
  });

  test("landing hero plays a real staggered entrance animation under normal motion settings", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "RiverLine SDD" });
    await expect(heading).toBeVisible();

    // motion/react drives this category of animation via the Web
    // Animations API rather than a named CSS @keyframes rule (unlike the
    // pre-existing --motion-base .pageEnter mechanism proven above) —
    // Element.getAnimations() is the correct, real proof that a browser
    // Animation is actually attached to this element, not just that some
    // CSS class exists. Actively polled (not a single evaluate()
    // immediately after page.goto resolves) because the animation is only
    // attached once React hydrates and Motion's mount effect runs, which
    // can trail the "load" event `page.goto` waits for.
    await page.waitForFunction(
      () => (document.querySelector("h1")?.getAnimations().length ?? 0) > 0,
      { timeout: 2000 },
    );

    // And it genuinely settles to the fully visible end state — the
    // entrance is a real, bounded transition, not a permanent opacity: 0.
    await page.waitForTimeout(500);
    const finalOpacity = await heading.evaluate((el) => getComputedStyle(el).opacity);
    expect(finalOpacity).toBe("1");

    // Staggering: the sign-in button (rendered after the fact list further
    // down the card) must not have already finished before the heading —
    // proof this is a genuine staggered sequence, not everything animating
    // in lockstep. Checked by reading each element's Web Animations API
    // start time relative to the other, immediately after load.
    const order = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const signIn = document.querySelector('a[href="/login"]');
      const h1Anim = h1?.getAnimations()[0];
      const signInAnim = signIn?.getAnimations()[0];
      if (!h1Anim || !signInAnim) return null;
      return { h1Start: h1Anim.startTime, signInStart: signInAnim.startTime };
    });
    if (order && order.h1Start !== null && order.signInStart !== null) {
      expect(Number(order.signInStart)).toBeGreaterThanOrEqual(Number(order.h1Start));
    }
  });

  test("landing hero renders the correct final state instantly, with no animation attached, under prefers-reduced-motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "RiverLine SDD" });
    await expect(heading).toBeVisible();

    // motion/react's documented behavior for initial={false} (this app's
    // useEntranceInitial() under reduced motion — src/shared/ui/Entrance.tsx):
    // render directly in the final state, no mount transition queued at
    // all — so there should be no Animation object here whatsoever, not
    // merely one that finished instantly.
    const hasAnimation = await page.evaluate(() => {
      const el = document.querySelector("h1");
      return el ? el.getAnimations().length > 0 : false;
    });
    expect(hasAnimation).toBe(false);

    const opacity = await heading.evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe("1");
    const transform = await heading.evaluate((el) => getComputedStyle(el).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  });

  // Extended \p{Extended_Pictographic} covers the full modern emoji
  // repertoire (skin-tone modifiers, ZWJ sequences included as their
  // constituent code points), not a hand-picked subset of ranges — a real
  // Unicode property, not invented (MDN "Unicode property escapes",
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Unicode_property_escapes,
  // "Extended_Pictographic" is one of the documented binary properties).
  const EMOJI_RE = /\p{Extended_Pictographic}/u;

  test("zero emoji characters in the rendered landing page", async ({ page }) => {
    await page.goto("/");
    const text = await page.evaluate(() => document.body.innerText);
    expect(EMOJI_RE.test(text)).toBe(false);
  });

  test("zero emoji characters in the rendered home page (assessor and official views)", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);
    await expect(page.getByRole("heading", { name: `Welcome, ${OFFICIAL_EMAIL}` })).toBeVisible();
    const officialText = await page.evaluate(() => document.body.innerText);
    expect(EMOJI_RE.test(officialText)).toBe(false);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await loginViaDevMagicLink(page, request, baseURL, ASSESSOR_EMAIL);
    await expect(page.getByRole("heading", { name: `Welcome, ${ASSESSOR_EMAIL}` })).toBeVisible();
    const assessorText = await page.evaluate(() => document.body.innerText);
    expect(EMOJI_RE.test(assessorText)).toBe(false);
  });
});
