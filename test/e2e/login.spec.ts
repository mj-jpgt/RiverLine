import { expect, test } from "@playwright/test";

// Real login through the dev magic-link route (no mailbox in dev — the
// server logs the link and exposes it at a dev-only route, per
// specs/constitution.md §6). Requires the seeded demo users
// (scripts/db/seed.mjs) to exist in the database `pnpm dev` is pointed at.
const DEMO_EMAIL = "assessor@example.gov";

test.describe("M0 auth — magic-link login", () => {
  test("requesting a link, following it, and logging out works end to end", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    const emailInput = page.getByLabel("Email address");
    const submit = page.getByRole("button", { name: "Send sign-in link" });

    // Empty submit stays disabled (validation state, not a silent no-op).
    await expect(submit).toBeDisabled();

    // pressSequentially, not fill: WebKit does not reliably fire the input
    // events a React-controlled type="email" field needs when the value is
    // set programmatically via fill() (verified empirically in this
    // session — the button stayed disabled on the mobile-safari project
    // even though the DOM value was correctly set).
    await emailInput.pressSequentially(DEMO_EMAIL);
    // Generous timeout: under full parallel worker load, real WebKit
    // keystroke dispatch + React re-render can exceed the 5s default here
    // even though it's not slow in isolation (verified single-worker).
    await expect(submit).toBeEnabled({ timeout: 15000 });
    await submit.click();

    await expect(page.getByRole("status")).toHaveText(/sign-in link was sent/i);

    // Dev-only route: fetch the real link the server just issued instead of
    // an inbox. This is exercising the real request-link -> token -> verify
    // flow, not a bypass — the token still has to be looked up, hashed-
    // matched, and consumed by /api/auth/verify.
    const linkResponse = await request.get(
      `/api/dev/magic-link?email=${encodeURIComponent(DEMO_EMAIL)}`,
    );
    expect(linkResponse.ok()).toBe(true);
    const { url } = (await linkResponse.json()) as { url: string };
    expect(url).toContain("/api/auth/verify?token=");

    await page.goto(new URL(url, baseURL).toString());

    // Lands on an authenticated page.
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: `Welcome, ${DEMO_EMAIL}` })).toBeVisible();
    await expect(page.getByText("assessor", { exact: true })).toBeVisible();

    // Logout works.
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Unauthenticated access to a protected route redirects.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("unauthenticated visit to /home redirects to /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);
  });
});
