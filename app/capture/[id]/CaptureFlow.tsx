"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addExteriorPhoto,
  addPhotoToElement,
  canAdvanceFromStep,
  completeDraft,
  createDraft,
  elementsForOccupancy,
  FOUNDATION_TYPES,
  getResumableDraftForStructure,
  goToStep,
  newClientId,
  newPhotoUploadState,
  registerSyncTriggers,
  removeExteriorPhoto,
  removePhotoFromElement,
  saveDraft,
  savePhoto,
  screenForStep,
  setAttributes,
  setElementDamage,
  setGps,
  setNotes,
  setOccupancy,
  setWaterDepth,
  syncAllQueued,
  totalSteps,
  type CaptureDraft,
  type FoundationType,
  type Occupancy,
  type PhotoUploadProgress,
  type WaterDepthSource,
} from "@/core/capture";
import type { RegistryStructureDetail } from "@/core/registry";
import { AttributesScreen } from "./_components/AttributesScreen";
import { ElementScreen } from "./_components/ElementScreen";
import { ExteriorPhotoScreen } from "./_components/ExteriorPhotoScreen";
import { WaterDepthScreen } from "./_components/WaterDepthScreen";
import { NotesScreen } from "./_components/NotesScreen";
import { ReviewScreen } from "./_components/ReviewScreen";
import { OfflineBanner, type BannerState } from "./_components/OfflineBanner";
import styles from "./capture.module.css";

function coerceFoundationType(value: string | null): FoundationType | null {
  if (!value) return null;
  const known = FOUNDATION_TYPES.map((f) => f.value) as string[];
  return known.includes(value) ? (value as FoundationType) : null;
}

export function CaptureFlow({
  structureId,
  jurisdictionId,
  structure,
}: {
  structureId: string;
  jurisdictionId: string;
  structure: RegistryStructureDetail;
}) {
  const router = useRouter();
  const [draft, setDraftState] = useState<CaptureDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [completing, setCompleting] = useState(false);
  // F2: live "uploading N of M" state for whichever draft is currently mid
  // sync attempt (src/core/capture/sync.ts's onPhotoProgress callback).
  // null whenever no photo upload is in flight for the CURRENTLY DISPLAYED
  // draft — syncAllQueued can process other queued drafts too, but this
  // screen only shows progress for its own clientId, filtered below.
  const [photoProgress, setPhotoProgress] = useState<{ uploaded: number; total: number } | null>(null);
  const draftRef = useRef<CaptureDraft | null>(null);

  // ---- draft load / create --------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await getResumableDraftForStructure(structureId);
      if (cancelled) return;
      if (existing) {
        draftRef.current = existing;
        setDraftState(existing);
        setLoading(false);
        return;
      }
      const created = createDraft(
        structureId,
        jurisdictionId,
        {
          occupancyType: structure.occupancyType,
          sqFt: structure.sqFt,
          stories: structure.stories,
          foundationType: coerceFoundationType(structure.foundationType),
        },
        newClientId(),
      );
      await saveDraft(created);
      if (cancelled) return;
      draftRef.current = created;
      setDraftState(created);
      setLoading(false);

      // GPS at start (item 5): non-blocking, degrades gracefully.
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const gps = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracyM: pos.coords.accuracy,
            };
            void persist((d) => setGps(d, gps));
          },
          () => {
            void persist((d) => setGps(d, null));
          },
          { timeout: 10000, maximumAge: 60000 },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per structureId
  }, [structureId]);

  // ---- persistence helper ------------------------------------------------
  const persist = useCallback(async (update: (d: CaptureDraft) => CaptureDraft) => {
    const current = draftRef.current;
    if (!current) return;
    const next = update(current);
    draftRef.current = next;
    setDraftState(next);
    await saveDraft(next);
  }, []);

  // ---- online / offline + queue count ------------------------------------
  const refreshQueueCount = useCallback(async () => {
    const { getQueuedDrafts } = await import("@/core/capture");
    const queued = await getQueuedDrafts();
    setQueuedCount(queued.length);
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refreshQueueCount();
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshQueueCount]);

  // ---- sync trigger wiring (foreground-only, ADR 0002) --------------------
  // Deliberately does NOT gate on navigator.onLine: it is a well-documented
  // unreliable signal (can read true with no real connectivity, and — per
  // real testing during this task's build — a browser's online/offline
  // heuristic can flip to false after an observed failed request and stay
  // there). Gating a sync attempt on it risks a permanently-stuck offline
  // banner with no way to self-correct, since nothing would ever prove
  // connectivity is back. The actual fetch + retry/backoff in
  // src/core/capture/sync.ts is the real source of truth for reachability;
  // this trigger just decides *when* to try, not whether it's allowed to.
  const runSync = useCallback(
    async (options: { force?: boolean } = {}) => {
      setSyncing(true);
      setSyncError(null);
      setPhotoProgress(null);
      const onPhotoProgress = (progress: PhotoUploadProgress) => {
        // Only reflect progress for the draft this screen is currently
        // showing — syncAllQueued can walk through other queued drafts too,
        // and their progress isn't this screen's story to tell.
        if (draftRef.current?.clientId === progress.clientId) {
          setPhotoProgress({ uploaded: progress.uploaded, total: progress.total });
        }
      };
      const results = await syncAllQueued({ ...options, onPhotoProgress });
      setSyncing(false);
      setPhotoProgress(null);
      await refreshQueueCount();
      // A skipped attempt (still within backoff cooldown, or already
      // in-flight) returns ok:false with no error message — not a real
      // failure to surface, just "nothing to do yet".
      const failed = results.find((r) => !r.ok && r.error !== null);
      if (failed) {
        setSyncError(failed.error);
      } else if (results.some((r) => r.ok)) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 2500);
      }
      // Refresh the current draft in case it was the one that just synced.
      if (draftRef.current) {
        const { getDraft } = await import("@/core/capture");
        const refreshed = await getDraft(draftRef.current.clientId);
        if (refreshed) {
          draftRef.current = refreshed;
          setDraftState(refreshed);
        }
      }
    },
    [refreshQueueCount],
  );

  useEffect(() => registerSyncTriggers(() => void runSync()), [runSync]);

  // ---- navigation ----------------------------------------------------------
  const stepIndex = draft?.stepIndex ?? 0;
  const total = draft ? totalSteps(draft) : 1;
  const screen = draft ? screenForStep(draft, stepIndex) : null;
  const canAdvance = draft ? canAdvanceFromStep(draft, stepIndex) : false;

  const goNext = useCallback(async () => {
    if (!draftRef.current) return;
    setDirection("forward");
    await persist((d) => goToStep(d, Math.min(d.stepIndex + 1, totalSteps(d) - 1)));
  }, [persist]);

  const goBack = useCallback(async () => {
    if (!draftRef.current) return;
    setDirection("back");
    await persist((d) => goToStep(d, Math.max(d.stepIndex - 1, 0)));
  }, [persist]);

  const handleComplete = useCallback(async () => {
    if (!draftRef.current) return;
    setCompleting(true);
    const completed = completeDraft(draftRef.current);
    draftRef.current = completed;
    setDraftState(completed);
    await saveDraft(completed);
    await refreshQueueCount();
    setCompleting(false);
    // Attempt sync immediately on completion (trigger #1 of ADR 0002's
    // list) — deliberately NOT awaited inline here. Completing the
    // assessment must never UI-block on network reachability (the whole
    // point of this module), and routing through the same runSync() path
    // the 'online' event / manual "Sync now" use keeps exactly one code
    // path responsible for the syncing/justSynced/error UI state instead
    // of duplicating it. Deferred one tick via setTimeout so this runs as
    // its own fresh task rather than a continuation of the click handler.
    setTimeout(() => void runSync({ force: true }), 0);
  }, [refreshQueueCount, runSync]);

  const elementDefs = useMemo(
    () => (draft?.occupancyType ? elementsForOccupancy(draft.occupancyType) : []),
    [draft?.occupancyType],
  );

  // Never silent while there is real queued work (AGENTS.md rule 7): even if
  // no specific error message is currently set, a nonzero queuedCount with
  // nothing else going on means a sync attempt is due and the visible
  // manual retry must be reachable — falls into the same "error" banner
  // state (its text has a sensible generic fallback when errorMessage is
  // null) rather than silently going to "hidden".
  const bannerState: BannerState = !online
    ? "offline"
    : syncing
      ? "syncing"
      : syncError || queuedCount > 0
        ? "error"
        : justSynced
          ? "synced"
          : "hidden";

  if (loading || !draft || !screen) {
    return (
      <div className={styles.statePanel} role="status">
        Loading assessment…
      </div>
    );
  }

  const isComplete = draft.completedAt !== null;

  // F2 fix for the reported contradictory copy: this screen used to have
  // its own separate `draft.syncStatus === "synced" ? ... : online ? ...`
  // chain that never checked `syncError` at all, so a real sync failure
  // could show "Saved on this device — syncing now." at the exact same
  // moment the banner above showed "Sync failed". One function, the same
  // state (syncError/syncing/online/photoProgress) that already drives
  // `bannerState` above, is now the only source of truth for what this
  // subheading says — a real error always wins and is never masked by a
  // stale "syncing now".
  const completeSubheading: string =
    draft.syncStatus === "synced"
      ? "Synced to the server."
      : syncError
        ? syncError
        : syncing
          ? photoProgress && photoProgress.uploaded < photoProgress.total
            ? `Saved on this device. Uploading photo ${photoProgress.uploaded + 1} of ${photoProgress.total}.`
            : "Saved on this device. Syncing now."
          : !online
            ? "Saved on this device. It will sync automatically once you are back online, or tap Sync now above."
            : "Saved on this device. Queued to sync.";

  return (
    <div className={styles.shell}>
      <OfflineBanner
        state={bannerState}
        queuedCount={queuedCount}
        errorMessage={syncError}
        onSyncNow={() => void runSync({ force: true })}
        photoProgress={photoProgress}
      />

      {isComplete ? (
        <div className={styles.completeState}>
          <h1 className={styles.completeHeading}>Assessment complete</h1>
          <p className={styles.subheading}>{completeSubheading}</p>
          <div className={styles.completeActions}>
            {draft.syncStatus === "synced" ? (
              // The calculation trigger (M3/T-C4): once synced, the 50%-rule
              // calculation can run. Visiting this link is the "on-demand"
              // trigger path (task instructions #2) — the calculation page
              // itself auto-computes on first view.
              <button
                type="button"
                className={styles.navButtonNext}
                onClick={() => router.push(`/calculation/${draft.clientId}`)}
              >
                View calculation
              </button>
            ) : null}
            <button
              type="button"
              className={styles.navButtonBack}
              onClick={() => router.push(`/registry/${structureId}`)}
            >
              Back to structure
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.progressWrap}>
            <p className={styles.progressLabel}>
              Step {stepIndex + 1} of {total}
            </p>
            <div className={styles.progressTrack} role="presentation">
              {Array.from({ length: total }, (_, i) => (
                <div key={i} className={i <= stepIndex ? styles.progressSegmentDone : styles.progressSegment} />
              ))}
            </div>
          </div>

          <div className={styles.screenViewport}>
            <div
              key={stepIndex}
              className={`${styles.screen} ${direction === "forward" ? styles.screenEnterForward : styles.screenEnterBack}`}
            >
              {screen.kind === "attributes" ? (
                <AttributesScreen
                  draft={draft}
                  address={structure.address}
                  onSetOccupancy={(o: Occupancy) => void persist((d) => setOccupancy(d, o))}
                  onSetAttributes={(attrs) => void persist((d) => setAttributes(d, attrs))}
                />
              ) : null}

              {screen.kind === "element" ? (
                <ElementScreen
                  element={draft.elements[screen.index]!}
                  definition={elementDefs[screen.index]!}
                  index={screen.index}
                  total={draft.elements.length}
                  onSetDamage={(pct) => void persist((d) => setElementDamage(d, screen.code, pct))}
                  onAddPhoto={(processed) => {
                    void (async () => {
                      const id = crypto.randomUUID();
                      await savePhoto({
                        id,
                        clientId: draft.clientId,
                        elementCode: screen.code,
                        sha256: processed.sha256,
                        capturedAt: new Date().toISOString(),
                        gps: draftRef.current?.gps ?? null,
                        blob: processed.blob,
                        width: processed.width,
                        height: processed.height,
                        ...newPhotoUploadState(),
                      });
                      await persist((d) => addPhotoToElement(d, screen.code, id));
                    })();
                  }}
                  onRemovePhoto={(photoId) => void persist((d) => removePhotoFromElement(d, screen.code, photoId))}
                />
              ) : null}

              {screen.kind === "exterior_photo" ? (
                <ExteriorPhotoScreen
                  photoIds={draft.exteriorPhotoIds}
                  onAddPhoto={(processed) => {
                    void (async () => {
                      const id = crypto.randomUUID();
                      await savePhoto({
                        id,
                        clientId: draft.clientId,
                        elementCode: null,
                        sha256: processed.sha256,
                        capturedAt: new Date().toISOString(),
                        gps: draftRef.current?.gps ?? null,
                        blob: processed.blob,
                        width: processed.width,
                        height: processed.height,
                        ...newPhotoUploadState(),
                      });
                      await persist((d) => addExteriorPhoto(d, id));
                    })();
                  }}
                  onRemovePhoto={(photoId) => void persist((d) => removeExteriorPhoto(d, photoId))}
                />
              ) : null}

              {screen.kind === "water_depth" ? (
                <WaterDepthScreen
                  depthIn={draft.waterDepthInteriorIn}
                  source={draft.waterDepthSource}
                  onChange={(depthIn, source: WaterDepthSource | null) =>
                    void persist((d) => setWaterDepth(d, depthIn, source))
                  }
                />
              ) : null}

              {screen.kind === "notes" ? (
                <NotesScreen notes={draft.notes} onChange={(notes) => void persist((d) => setNotes(d, notes))} />
              ) : null}

              {screen.kind === "review" ? (
                <ReviewScreen
                  draft={draft}
                  elementDefs={elementDefs}
                  onComplete={() => void handleComplete()}
                  completing={completing}
                  canComplete={canAdvanceFromStep(draft, stepIndex)}
                />
              ) : null}
            </div>
          </div>

          {screen.kind !== "review" ? (
            <div className={styles.navBar}>
              <button type="button" className={styles.navButtonBack} onClick={() => void goBack()} disabled={stepIndex === 0}>
                Back
              </button>
              <button type="button" className={styles.navButtonNext} onClick={() => void goNext()} disabled={!canAdvance}>
                Next
              </button>
            </div>
          ) : (
            <div className={styles.navBar}>
              <button type="button" className={styles.navButtonBack} onClick={() => void goBack()}>
                Back
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
