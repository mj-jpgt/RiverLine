import { expect, test } from "@playwright/test";

// T-W1: app shell, front-door landing, and role-aware /home launchpad.
// Runs in the ROOT suite (playwright.config.ts, baseURL http://localhost:
// 3000, `pnpm dev` webServer against riverline_dev) — no dedicated config,
// no cost-table dependency, same pattern registry.spec.ts/calculation.spec.ts
// already use. Relative page.goto() paths only, so this file needs no
// change to playwright.config.ts (not in this task's assigned paths).
//
// Demo accounts (scripts/db/seed.mjs): admin@example.gov, assessor@
// example.gov, official@example.gov. official@example.gov is also used by
// registry.spec.ts, which now runs concurrently with this file under
// `fullyParallel` — safe per src/core/auth/dev-link-store.ts's documented
// per-email FIFO queue fix (each concurrent request-link + dev-magic-link
// GET pair gets its own distinct, never-reused token).
const OFFICIAL_EMAIL = "official@example.gov";
const ASSESSOR_EMAIL = "assessor@example.gov";
const PRACTICE_ADDRESS = "123 Practice Ln";

async function loginViaDevMagicLink(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  baseURL: string | undefined,
  email: string,
) {
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

test.describe("T-W1 app shell", () => {
  test("unauthenticated landing is a real front door, not the build placeholder", async ({ page }) => {
    await page.goto("/");

    // The exact scaffold copy this task exists to delete.
    await expect(page.getByText("No product UI exists yet")).toHaveCount(0);
    await expect(page.getByText("Toolchain scaffold.")).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "RiverLine SDD" })).toBeVisible();
    await expect(page.getByText("Substantial-damage determination instrument")).toBeVisible();

    const signIn = page.getByRole("link", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    const box = await signIn.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);

    await signIn.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("official: role-aware /home, persistent shell nav to registry and dashboard, sign out returns to the front door", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, OFFICIAL_EMAIL);

    // ---- /home: single "Welcome" heading, single role chip, real counts ---
    await expect(page.getByRole("heading", { name: `Welcome, ${OFFICIAL_EMAIL}` })).toBeVisible();
    // Exact match — must resolve to exactly one element (the shell header's
    // role chip). If a duplicate ever gets reintroduced elsewhere on the
    // page, this line (and login.spec.ts) fails on Playwright's strict-mode
    // "multiple elements" error, not a false pass.
    await expect(page.getByText("official", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Determination review" })).toBeVisible();
    await expect(page.getByText("Awaiting review")).toBeVisible();
    await expect(page.getByText("Borderline — requires review")).toBeVisible();
    await expect(page.getByRole("link", { name: "Determination queue" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Jurisdiction dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Administrator dashboard" })).toBeVisible();

    // Honest config status — real jurisdiction row, not a hardcoded value.
    await expect(page.getByRole("heading", { name: "Determination letters" })).toBeVisible();
    await expect(page.getByText(/Ordinance citation (on file|missing)/)).toBeVisible();

    // Default sync/offline state: nothing queued on a fresh browser
    // context, so the persistent sync strip renders nothing (not a blank
    // placeholder — the component's real "hidden" state per
    // src/shared/ui/SyncStatusIndicator.tsx).
    await expect(page.locator('[role="status"]')).toHaveCount(0);

    // ---- Focus-visible is a real, non-zero outline, not just present-but-
    //      unused CSS. Focused directly (not a blind Tab-count) so this
    //      doesn't depend on how many other focusable elements Next.js's
    //      dev-mode overlay happens to insert. ---------------------------
    const brandLink = page.getByRole("link", { name: "RiverLine SDD" });
    await brandLink.focus();
    await expect(brandLink).toBeFocused();
    const outlineWidth = await brandLink.evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outlineWidth).not.toBe("0px");

    // ---- Nav to registry via the persistent header, not a page reload ----
    const findStructureNav = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Find structure",
    });
    await expect(findStructureNav).toBeVisible();
    const navBox = await findStructureNav.boundingBox();
    expect(navBox?.height).toBeGreaterThanOrEqual(48);
    await expect(findStructureNav).not.toHaveAttribute("aria-current", "page");

    await findStructureNav.click();
    await expect(page).toHaveURL(/\/registry$/);
    await expect(page.getByRole("heading", { name: "Find a structure" })).toBeVisible();
    // Scoped to the <header> specifically — app/registry/page.tsx's own
    // eyebrow text is the identical string "Structure registry", so an
    // unscoped getByText() would match two elements and fail strict mode.
    await expect(page.locator("header").getByText("Structure registry")).toBeVisible();
    // Active-state proof: the same nav link now marks itself current.
    await expect(findStructureNav).toHaveAttribute("aria-current", "page");

    // ---- Nav to dashboard, still via the header ---------------------------
    const dashboardNav = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Dashboard" });
    await dashboardNav.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Jurisdiction caseload" })).toBeVisible();
    // Same scoping reason: app/dashboard/page.tsx's own eyebrow is also
    // literally "Administrator dashboard".
    await expect(page.locator("header").getByText("Administrator dashboard")).toBeVisible();
    await expect(dashboardNav).toHaveAttribute("aria-current", "page");

    // ---- Sign out: the one persistent control, works from any page -------
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Back at an unauthenticated entry point — the shell header is gone
    // entirely (no stray "Log out"/nav left over from the old session).
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "RiverLine SDD" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("assessor: role-gated nav (no dead links), queued-assessments empty state, shell hides on the capture flow", async ({
    page,
    request,
    baseURL,
  }) => {
    await loginViaDevMagicLink(page, request, baseURL, ASSESSOR_EMAIL);

    await expect(page.getByRole("heading", { name: `Welcome, ${ASSESSOR_EMAIL}` })).toBeVisible();
    await expect(page.getByText("assessor", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Field assessment" })).toBeVisible();
    // Scoped to <main> — the header's own "Find structure" nav link (also
    // visible for the assessor role) has the identical prefix, and an
    // unscoped locator would match both.
    const findStructureCta = page.locator("main").getByRole("link", { name: /^Find structure/ });
    await expect(findStructureCta).toBeVisible();

    // Real, client-fetched offline-queue state (src/core/capture's
    // getQueuedDrafts, not a hardcoded array) — empty on a fresh browser
    // context, and the empty state is designed, not a blank area.
    await expect(page.getByRole("heading", { name: "My queued assessments" })).toBeVisible();
    await expect(page.getByText(/No assessments queued on this device/)).toBeVisible();

    // An assessor has no access to /determination or /dashboard
    // (app/determination/page.tsx, app/dashboard/page.tsx both role-guard
    // ["admin","official"]) — the shell hides those nav items rather than
    // rendering a dead/disabled link to a route that would 403 or redirect.
    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    await expect(primaryNav.getByRole("link", { name: "Review queue" })).toHaveCount(0);
    await expect(primaryNav.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(primaryNav.getByRole("link", { name: "Find structure" })).toBeVisible();

    // ---- The shell hides entirely on the capture flow ---------------------
    await page.goto("/registry");
    await page.getByLabel("Address").pressSequentially(PRACTICE_ADDRESS);
    const resultLink = page.getByRole("link", { name: new RegExp(PRACTICE_ADDRESS) });
    await expect(resultLink).toBeVisible({ timeout: 10000 });
    await resultLink.click();

    await expect(page.getByRole("link", { name: "Start assessment" })).toBeVisible();
    await page.getByRole("link", { name: "Start assessment" }).click();
    await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/);

    // No shell chrome on this screen — capture keeps full-screen,
    // one-decision-per-screen focus and ships its own OfflineBanner
    // (app/capture/[id]/_components/OfflineBanner.tsx).
    await expect(page.getByRole("link", { name: "RiverLine SDD" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

    // Capture's own real UI is unaffected by the shell change.
    await expect(page.getByText("Confirm structure")).toBeVisible();

    // Shell reappears once back on a normal authenticated route.
    await page.goto("/home");
    await expect(page.getByRole("link", { name: "RiverLine SDD" })).toBeVisible();
  });
});
