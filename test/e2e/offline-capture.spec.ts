import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
// Relative import, not the "@/core/auth" alias: this file is outside
// eslint-plugin-boundaries' checked globs (src/**, app/**) and outside
// Playwright's own module graph guarantees for tsconfig path aliases, so a
// plain relative import is the reliable choice here.
import { createSessionCookieValue, SESSION_COOKIE_NAME } from "../../src/core/auth/session";

// T-C3 acceptance gate: `pnpm test:offline` (scripts/test-offline.mjs runs
// this spec against a real PRODUCTION build — Serwist only precaches in
// production, ADR 0002 — on a dedicated port; see playwright.offline.config.ts).
//
// Proves, against the real app (no mocks, real Postgres, real service
// worker), end to end:
//   1. The app shell for /capture/[id] loads offline after one prior visit
//      (Serwist precache — task requirement #9).
//   2. A full 12-element residential assessment can be captured entirely
//      with the network disabled: attributes, all 12 elements with damage %
//      and >=2 real photos, the required exterior photo, water depth,
//      notes, review, complete.
//   3. Killing/reloading the page mid-flow resumes from the IndexedDB draft
//      (no re-entry of already-captured elements).
//   4. The offline banner is visible with an accurate queued count for the
//      entire offline window.
//   5. Re-enabling the network and syncing lands the assessment, its 12
//      elements, and its photos (with sha256) in Postgres.
//   6. Re-submitting the exact same payload (idempotency probe, OT-5) does
//      not duplicate any row.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Playwright (unlike Next.js) does not auto-load .env.local — load it here
// so this spec's own direct Postgres verification queries can reach the
// same riverline_dev database the production server under test is using.
// Same minimal parser vitest.config.ts already uses for the unit suite.
const envLocalPath = path.resolve(__dirname, "../../.env.local");
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// A different demo user than login.spec.ts (assessor@example.gov) and
// registry.spec.ts (official@example.gov) — same reasoning as
// registry.spec.ts's own comment: the dev-only magic-link store
// (src/core/auth/dev-link-store.ts) holds one pending link per email. This
// spec runs its own dedicated production server/process, so there is no
// literal risk of colliding with the dev-suite's login flow — but the real
// reason a distinct email is worth keeping is documentation: it makes clear
// this spec never touches the shared dev-link-store fixture at all (see
// loginWithSignedSessionCookie below).
const DEMO_EMAIL = "admin@example.gov";
const PRACTICE_ADDRESS = "123 Practice Ln";

const ELEMENT_FIXTURE = path.resolve(__dirname, "../fixtures/photos/sample-element.jpg");
const EXTERIOR_FIXTURE = path.resolve(__dirname, "../fixtures/photos/sample-exterior.jpg");

/**
 * `pnpm test:offline` runs against a real PRODUCTION build/server (see the
 * file header — that's the only way to prove the Serwist precache actually
 * works, ADR 0002). The dev-only magic-link bypass
 * (app/api/dev/magic-link/route.ts, src/core/auth/dev-link-store.ts) is
 * correctly and deliberately hard-gated off whenever
 * `process.env.NODE_ENV === "production"` (specs/constitution.md §6: "never
 * a bypass in production code paths") — `next start` always forces
 * NODE_ENV=production, so that route 500s here by design, not by bug.
 *
 * This is not a workaround for that gate: it mints the exact same session
 * cookie app/api/auth/verify/route.ts creates after a real magic-link
 * verification (`createSessionCookieValue`, the same function, same
 * signing key) for a real seeded user row, and installs it directly via
 * `context.addCookies` before the first navigation. The auth module's own
 * login UI/token flow is already covered end to end by test/e2e/login.spec.ts
 * against the dev server; this spec's job is the capture flow, not
 * re-proving login, so seeding a real, correctly-signed session is the
 * right amount of setup rather than driving UI that is deliberately
 * unavailable in this build.
 */
async function loginWithSignedSessionCookie(context: BrowserContext, baseURL: string | undefined, admin: pg.Client) {
  const userRow = await admin.query(
    "select id, jurisdiction_id, role from users where email = $1",
    [DEMO_EMAIL],
  );
  if (userRow.rows.length === 0) {
    throw new Error(`Demo user ${DEMO_EMAIL} not found — run \`node scripts/db/seed.mjs\` first.`);
  }
  const { id: userId, jurisdiction_id: jurisdictionId, role } = userRow.rows[0] as {
    id: string;
    jurisdiction_id: string;
    role: "admin" | "assessor" | "official" | "viewer";
  };

  const { value, maxAgeSeconds } = createSessionCookieValue({
    userId,
    jurisdictionId,
    role,
    email: DEMO_EMAIL,
  });

  const url = new URL(baseURL ?? "http://localhost:3100");
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      // Explicit false regardless of NODE_ENV: this cookie is injected
      // directly (not via a Set-Cookie response header), and the test
      // server runs over plain http://localhost — matches what a real
      // browser would actually be able to send back on subsequent requests
      // to this origin.
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + maxAgeSeconds,
    },
  ]);
}

/** Every screen-advance write (src/core/capture/CaptureFlow.tsx `persist()`)
 * is a real async IndexedDB transaction — a `click()` resolving proves the
 * click was dispatched, not that the resulting write has committed yet. A
 * genuine OS-level force-quit (the real scenario OT-2/build spec §6.1
 * describe) always has at least a few ms of user gesture time before the
 * process actually dies, which is more than enough for a `put()` to commit
 * — but Playwright can call `page.reload()` faster than that. Poll for the
 * write actually landing before simulating the kill, so this test proves
 * "resume works once the auto-save has happened" (the product's real
 * guarantee), not an impossible zero-latency race no async storage API can
 * promise. */
async function waitForPersistedStepIndex(page: Page, structureId: string, expectedStepIndex: number) {
  await expect
    .poll(
      () =>
        page.evaluate((targetStructureId: string) => {
          return new Promise<number | null>((resolve) => {
            const req = indexedDB.open("riverline-capture");
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction("drafts", "readonly");
              const getAllReq = tx.objectStore("drafts").getAll();
              getAllReq.onsuccess = () => {
                const drafts = getAllReq.result as {
                  structureId: string;
                  stepIndex: number;
                  updatedAt: string;
                }[];
                const forStructure = drafts
                  .filter((d) => d.structureId === targetStructureId)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
                resolve(forStructure[0] ? forStructure[0].stepIndex : null);
              };
              getAllReq.onerror = () => resolve(null);
            };
            req.onerror = () => resolve(null);
          });
        }, structureId),
      { timeout: 5000 },
    )
    .toBe(expectedStepIndex);
}

/** Reads the single (in this test) capture draft + its photos straight out
 * of IndexedDB in the browser, base64-encoding photo blobs exactly as
 * src/core/capture/payload.ts's buildSyncPayload does — used both to prove
 * the resume-from-draft behavior and to build the idempotency-probe
 * request from Node via the same authenticated request context. */
async function readDraftFromIndexedDb(page: Page, structureId: string) {
  return page.evaluate(async (targetStructureId: string) => {
    function openDb(): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("riverline-capture");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      });
    }
    async function blobToBase64(blob: Blob): Promise<string> {
      const buf = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0);
      return btoa(binary);
    }

    const db = await openDb();
    interface DraftRow {
      clientId: string;
      structureId: string;
      occupancyType: string | null;
      sqFt: number | null;
      stories: number | null;
      foundationType: string | null;
      gps: { lat: number; lng: number; accuracyM: number } | null;
      elements: { code: string; damagePct: number | null }[];
      exteriorPhotoIds: string[];
      waterDepthInteriorIn: number | null;
      waterDepthSource: string | null;
      notes: string;
      completedAt: string | null;
      startedAt: string;
      updatedAt: string;
      syncStatus: string;
      lastSyncError: string | null;
    }
    interface PhotoRow {
      id: string;
      clientId: string;
      elementCode: string | null;
      sha256: string;
      capturedAt: string;
      gps: { lat: number; lng: number; accuracyM: number } | null;
      blob: Blob;
    }
    // Pick the draft for THIS structure, most-recently-updated first —
    // mirrors src/core/capture/db.ts's getResumableDraftForStructure()
    // exactly. A blind drafts[0] would be wrong the moment more than one
    // draft record exists in this origin's IndexedDB (e.g. a leftover from
    // an earlier run against the same dev server/profile).
    const drafts = (await getAll<DraftRow>(db, "drafts"))
      .filter((d) => d.structureId === targetStructureId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const draft = drafts[0];
    if (!draft) return null;
    const photos = (await getAll<PhotoRow>(db, "photos")).filter((p) => p.clientId === draft.clientId);

    const payload = {
      clientId: draft.clientId,
      structureId: draft.structureId,
      structureUpdates: {
        occupancyType: draft.occupancyType,
        sqFt: draft.sqFt,
        stories: draft.stories,
        foundationType: draft.foundationType,
      },
      assessment: {
        gpsLat: draft.gps?.lat ?? null,
        gpsLng: draft.gps?.lng ?? null,
        gpsAccuracyM: draft.gps?.accuracyM ?? null,
        deviceCapturedAt: draft.startedAt,
        waterDepthInteriorIn: draft.waterDepthInteriorIn,
        waterDepthSource: draft.waterDepthSource,
        notes: draft.notes || null,
        completedAt: draft.completedAt,
      },
      elements: draft.elements
        .filter((e) => e.damagePct !== null)
        .map((e) => ({ elementCode: e.code, damagePct: e.damagePct })),
      photos: await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          elementCode: p.elementCode,
          sha256: p.sha256,
          capturedAt: p.capturedAt,
          gpsLat: p.gps?.lat ?? null,
          gpsLng: p.gps?.lng ?? null,
          dataBase64: await blobToBase64(p.blob),
          contentType: "image/jpeg" as const,
        })),
      ),
    };

    return {
      draftSummary: {
        clientId: draft.clientId,
        structureId: draft.structureId,
        syncStatus: draft.syncStatus,
        lastSyncError: draft.lastSyncError,
        elementCount: draft.elements.length,
        elementsWithDamage: draft.elements.filter((e) => e.damagePct !== null).length,
        exteriorPhotoCount: draft.exteriorPhotoIds.length,
        photoCount: photos.length,
      },
      payload,
    };
  }, structureId);
}

test.describe("T-C3 offline-first field capture", () => {
  let admin: pg.Client;

  test.beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — see .env.example. pnpm test:offline needs a real local Postgres.");
    }
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
  });

  test.afterAll(async () => {
    await admin.end();
  });

  test("completes a full offline assessment, resumes mid-flow after reload, and syncs idempotently", async ({
    page,
    context,
    baseURL,
  }) => {
    // Forward browser console errors into the test output — makes a CI
    // failure diagnosable without re-running locally with devtools open.
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[browser:error]", msg.text());
    });
    page.on("pageerror", (err) => {
      console.log("[browser:pageerror]", err.message);
    });

    // ---- 1. Log in and open a real structure, ONLINE -----------------------
    await loginWithSignedSessionCookie(context, baseURL, admin);
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: `Welcome, ${DEMO_EMAIL}` })).toBeVisible();

    await page.goto("/registry");
    await page.getByLabel("Address").pressSequentially(PRACTICE_ADDRESS);
    const resultLink = page.getByRole("link", { name: new RegExp(PRACTICE_ADDRESS) });
    await expect(resultLink).toBeVisible({ timeout: 10000 });
    await resultLink.click();

    await expect(page.getByRole("link", { name: "Start assessment" })).toBeVisible();
    await page.getByRole("link", { name: "Start assessment" }).click();
    await expect(page).toHaveURL(/\/capture\/[0-9a-f-]+$/);
    const structureId = page.url().split("/capture/")[1];
    if (!structureId) throw new Error(`Could not extract structureId from URL: ${page.url()}`);

    await expect(page.getByText("Confirm structure")).toBeVisible();

    // Give the service worker a moment to finish installing/activating from
    // this first (online) visit before we cut the network — this is what
    // "loads offline after first visit" depends on. Raced against an
    // explicit timeout inside the page so a broken/never-activating SW
    // fails this assertion instead of hanging the whole run.
    const swReady = await page
      .evaluate(() =>
        Promise.race([
          navigator.serviceWorker.ready.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15000)),
        ]),
      )
      .catch(() => false);
    expect(swReady).toBe(true);

    // Next.js <Link> navigation (registry -> structure -> "Start assessment")
    // is a client-side/RSC transition, not a full document GET — so the
    // Serwist "html" document cache (matched on the RESPONSE's
    // Content-Type) never saw a real navigation request for this exact
    // /capture/[id] URL yet. Force one real hard navigation while still
    // online so the service worker actually caches this page's document
    // response, exactly like a real first visit followed by "Add to Home
    // Screen" would (ADR 0002).
    await page.reload();
    await expect(page.getByText("Confirm structure")).toBeVisible();

    // ---- 2. Go fully offline -------------------------------------------------
    // Route-level interception, not context.setOffline(): in this
    // Playwright/Chromium build, setOffline(false) did not reliably restore
    // real connectivity after a service-worker-controlled navigation.
    // Aborting XHR/document/asset GET requests is fine (the SW's
    // NetworkFirst just needs a fast rejection to fall back to its
    // precache, proven working below); the sync endpoint's POST gets
    // route.fulfill() with a failing HTTP status instead of an abort — a
    // normal, completed response that exercises the exact same
    // retry/backoff/banner logic in src/core/capture/sync.ts as a real
    // "server unreachable" failure would, without relying on
    // connection-level abort semantics this environment doesn't always
    // propagate cleanly.
    await context.route("**/*", (route) => {
      if (route.request().method() === "POST") {
        void route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "offline simulation (test)" }),
        });
        return;
      }
      void route.abort("failed");
    });

    // Prove the precached app shell actually serves this route offline —
    // task requirement #9 ("Verify this actually works in the offline test"),
    // not just that a JS state machine keeps working after the fact.
    await page.reload();
    await expect(page.getByText("Confirm structure")).toBeVisible({ timeout: 10000 });

    // Real iOS Safari fires the `offline` event on a real connectivity
    // change; dispatch it explicitly here (this Chromium build's
    // navigator.onLine does not reliably reflect route-level blocking
    // either) so the app's real production listener
    // (src/core/capture/sync.ts's registerSyncTriggers + CaptureFlow's own
    // `window.addEventListener("offline", ...)`) is exercised the same way
    // a real device would.
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    // Offline banner is up immediately.
    await expect(page.getByRole("status").filter({ hasText: /offline/i })).toBeVisible({ timeout: 10000 });

    // ---- 3. Attributes screen (occupancy prefilled from the practice
    // structure's seed row — residential — so Next is enabled immediately) --
    await expect(page.getByRole("button", { name: "Residential", exact: true })).toHaveAttribute(
      "class",
      /optionButtonSelected/,
    );
    await page.getByRole("button", { name: "Next" }).click();

    // ---- 4. All 12 residential elements, offline ------------------------------
    const RESIDENTIAL_ELEMENT_COUNT = 12;
    for (let i = 0; i < RESIDENTIAL_ELEMENT_COUNT; i++) {
      await expect(page.getByText(`Element ${i + 1} of ${RESIDENTIAL_ELEMENT_COUNT}`)).toBeVisible();

      // Attach a real photo on the first two elements — ">= 2 photos" per
      // task spec; photos are optional on the rest to mirror how build
      // spec §5.3/§6.1 describe per-element photos (encouraged, not forced)
      // versus the always-required exterior shot.
      if (i < 2) {
        await page.getByLabel("Take photo").setInputFiles(ELEMENT_FIXTURE);
        await expect(page.locator("img[alt='Captured damage photo']")).toBeVisible({ timeout: 10000 });
      }

      await page.getByRole("button", { name: "10%" }).click();

      // Midpoint kill-and-reload probe (build spec §6.1 / OT-2): after the
      // 5th element, simulate the app being killed and reopened.
      if (i === 4) {
        await page.getByRole("button", { name: "Next" }).click();
        await waitForPersistedStepIndex(page, structureId, i + 2); // attributes(0) + elements 1..(i+1) => now at i+2
        await page.reload();
        // Every fresh navigation gets a clean JS context — re-assert the
        // offline signal for the same reason as the first offline reload
        // above (real iOS Safari would already know it's offline; this
        // Chromium build's navigator.onLine does not reliably propagate
        // across a reload under CDP network emulation).
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        // Resumes exactly where it left off — element 6, not element 1.
        await expect(page.getByText(`Element 6 of ${RESIDENTIAL_ELEMENT_COUNT}`)).toBeVisible({
          timeout: 10000,
        });
        await expect(page.getByRole("status").filter({ hasText: /offline/i })).toBeVisible();
        continue;
      }

      await page.getByRole("button", { name: "Next" }).click();
    }

    // ---- 5. Required exterior photo -------------------------------------------
    await expect(page.getByRole("heading", { name: "Exterior photo" })).toBeVisible();
    await page.getByLabel("Take exterior photo").setInputFiles(EXTERIOR_FIXTURE);
    await expect(page.locator("img[alt='Captured damage photo']")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Next" }).click();

    // ---- 6. Water depth --------------------------------------------------------
    await expect(page.getByText("Interior water depth")).toBeVisible();
    await page.getByLabel("Depth (inches)").fill("18");
    await page.getByRole("button", { name: "Measured" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    // ---- 7. Notes ---------------------------------------------------------------
    await expect(page.getByText("Assessment notes")).toBeVisible();
    await page.getByLabel("Notes").fill("Offline e2e test run — access via rear door, no other issues.");
    await page.getByRole("button", { name: "Next" }).click();

    // ---- 8. Review + complete, still fully offline ------------------------------
    await expect(page.getByText("Review and complete")).toBeVisible();
    const completeButton = page.getByRole("button", { name: "Complete assessment" });
    await expect(completeButton).toBeEnabled();
    await completeButton.click();

    await expect(page.getByRole("heading", { name: "Assessment complete" })).toBeVisible();

    // Offline banner still shows the queue, accurately, for the whole
    // offline window — not silent, not a toast (AGENTS.md rule 7).
    await expect(page.getByRole("status").filter({ hasText: /offline.*1 assessment queued/i })).toBeVisible();

    // ---- 9. Verify the draft + photos are really in IndexedDB, complete ---------
    const before = await readDraftFromIndexedDb(page, structureId);
    expect(before?.draftSummary.structureId).toBe(structureId);
    expect(before?.draftSummary.elementsWithDamage).toBe(RESIDENTIAL_ELEMENT_COUNT);
    expect(before?.draftSummary.exteriorPhotoCount).toBeGreaterThanOrEqual(1);
    expect(before?.draftSummary.photoCount).toBeGreaterThanOrEqual(2);
    expect(before?.draftSummary.syncStatus).not.toBe("synced");
    const clientId = before!.draftSummary.clientId;

    // ---- 10. Back online, sync ---------------------------------------------------
    await context.unroute("**/*");
    // Foreground trigger per ADR 0002 (never a background-sync event): the
    // real production listener is the browser's 'online' event
    // (src/core/capture/sync.ts registerSyncTriggers). Same test-tooling
    // gap as above — dispatch it explicitly so this exercises the real
    // listener rather than depending on navigator.onLine propagation.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // Real devices sometimes need a beat for connectivity to actually be
    // usable right after a network transition (DNS/connection re-establish).
    // The product's own answer to that is retry-with-backoff plus the
    // visible manual "Sync now" control (AGENTS.md rule 7) — exercise that
    // real UX here instead of assuming the very first attempt succeeds.
    await expect(async () => {
      const syncNow = page.getByRole("button", { name: "Sync now" });
      if (await syncNow.isVisible().catch(() => false)) {
        await syncNow.click();
      }
      const draft = await readDraftFromIndexedDb(page, structureId);
      expect(draft?.draftSummary.syncStatus).toBe("synced");
    }).toPass({ timeout: 45000, intervals: [1000, 2000, 3000] });

    await expect(page.getByRole("status").filter({ hasText: /offline/i })).toHaveCount(0);

    // ---- 11. Real DB verification ------------------------------------------------
    const assessmentRow = await admin.query(
      "select id, client_id, sync_status, completed_at, water_depth_interior_in, water_depth_source, notes from assessments where client_id = $1",
      [clientId],
    );
    expect(assessmentRow.rows).toHaveLength(1);
    expect(assessmentRow.rows[0].sync_status).toBe("synced");
    expect(assessmentRow.rows[0].completed_at).not.toBeNull();
    expect(Number(assessmentRow.rows[0].water_depth_interior_in)).toBe(18);
    expect(assessmentRow.rows[0].water_depth_source).toBe("measured");
    const assessmentId = assessmentRow.rows[0].id as string;

    const elementsRow = await admin.query(
      "select count(*)::int as n from assessment_elements where assessment_id = $1",
      [assessmentId],
    );
    expect(elementsRow.rows[0].n).toBe(RESIDENTIAL_ELEMENT_COUNT);

    const photosRow = await admin.query(
      "select sha256, storage_key from photos where assessment_id = $1 order by sha256",
      [assessmentId],
    );
    expect(photosRow.rows.length).toBeGreaterThanOrEqual(3); // 2 element photos + 1 exterior
    for (const row of photosRow.rows) {
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.storage_key).toBeTruthy();
    }

    // ---- 12. Idempotency probe (OT-5): resend the exact same payload -------------
    const resend = await readDraftFromIndexedDb(page, structureId);
    const resendResponse = await context.request.post("/api/capture/sync", {
      data: resend!.payload,
    });
    expect(resendResponse.ok()).toBe(true);
    const resendBody = (await resendResponse.json()) as { ok: boolean; alreadySynced: boolean };
    expect(resendBody.ok).toBe(true);
    expect(resendBody.alreadySynced).toBe(true);

    const assessmentCountAfter = await admin.query(
      "select count(*)::int as n from assessments where client_id = $1",
      [clientId],
    );
    expect(assessmentCountAfter.rows[0].n).toBe(1);

    const elementsCountAfter = await admin.query(
      "select count(*)::int as n from assessment_elements where assessment_id = $1",
      [assessmentId],
    );
    expect(elementsCountAfter.rows[0].n).toBe(RESIDENTIAL_ELEMENT_COUNT);

    const photosCountAfter = await admin.query(
      "select count(*)::int as n from photos where assessment_id = $1",
      [assessmentId],
    );
    expect(photosCountAfter.rows[0].n).toBe(photosRow.rows.length);
  });
});
