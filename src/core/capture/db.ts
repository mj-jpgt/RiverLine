// IndexedDB persistence for the offline capture flow, via `idb`
// (docs/adr/0002-offline-and-pwa.md decision #2 — a thin Promise wrapper,
// not Dexie, specifically so the retry/backoff/sync logic in ./sync.ts has
// full visibility into transaction boundaries rather than fighting an ORM).
//
// Every screen advance in the capture UI calls saveDraft() — there is no
// Save button anywhere (AGENTS.md "UI", build spec §6.1). Killing the tab
// and reopening reads the draft back via getDraftByStructure().
"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CaptureDraft, PhotoRecord } from "./types";

const DB_NAME = "riverline-capture";
const DB_VERSION = 1;

interface CaptureDbSchema extends DBSchema {
  drafts: {
    key: string; // clientId
    value: CaptureDraft;
    indexes: { structureId: string };
  };
  photos: {
    key: string; // photo id
    value: PhotoRecord;
    indexes: { clientId: string };
  };
}

let dbPromise: Promise<IDBPDatabase<CaptureDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<CaptureDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<CaptureDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const drafts = db.createObjectStore("drafts", { keyPath: "clientId" });
        drafts.createIndex("structureId", "structureId");
        const photos = db.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("clientId", "clientId");
      },
    });
  }
  return dbPromise;
}

export async function saveDraft(draft: CaptureDraft): Promise<void> {
  const db = await getDb();
  await db.put("drafts", { ...draft, updatedAt: new Date().toISOString() });
}

export async function getDraft(clientId: string): Promise<CaptureDraft | undefined> {
  const db = await getDb();
  return db.get("drafts", clientId);
}

/** Find the most recently updated in-progress (not yet synced) draft for a
 * structure, so re-opening /capture/[structureId] resumes it instead of
 * silently starting a second one. Synced drafts are excluded so a completed,
 * already-uploaded assessment doesn't block starting a new one later. */
export async function getResumableDraftForStructure(
  structureId: string,
): Promise<CaptureDraft | undefined> {
  const db = await getDb();
  const all = await db.getAllFromIndex("drafts", "structureId", structureId);
  const resumable = all.filter((d) => d.syncStatus !== "synced");
  resumable.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return resumable[0];
}

export async function getAllDrafts(): Promise<CaptureDraft[]> {
  const db = await getDb();
  return db.getAll("drafts");
}

/** Drafts that are complete and waiting to sync (or failed and need retry) —
 * this is "the queue" the offline banner counts. */
export async function getQueuedDrafts(): Promise<CaptureDraft[]> {
  const all = await getAllDrafts();
  return all.filter((d) => d.completedAt !== null && d.syncStatus !== "synced");
}

export async function savePhoto(photo: PhotoRecord): Promise<void> {
  const db = await getDb();
  await db.put("photos", photo);
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
  const db = await getDb();
  return db.get("photos", id);
}

export async function getPhotosForDraft(clientId: string): Promise<PhotoRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex("photos", "clientId", clientId);
}

export async function markSynced(clientId: string): Promise<void> {
  const db = await getDb();
  const draft = await db.get("drafts", clientId);
  if (!draft) return;
  await db.put("drafts", {
    ...draft,
    syncStatus: "synced",
    syncAttempts: 0,
    lastSyncError: null,
    lastAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function markSyncAttempt(
  clientId: string,
  status: "syncing" | "queued" | "error",
  error: string | null,
): Promise<void> {
  const db = await getDb();
  const draft = await db.get("drafts", clientId);
  if (!draft) return;
  const now = new Date().toISOString();
  await db.put("drafts", {
    ...draft,
    syncStatus: status,
    syncAttempts: status === "error" ? draft.syncAttempts + 1 : draft.syncAttempts,
    lastSyncError: error,
    lastAttemptAt: status === "syncing" ? draft.lastAttemptAt : now,
    updatedAt: now,
  });
}
