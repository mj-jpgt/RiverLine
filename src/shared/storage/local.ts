// Local-filesystem driver — the pre-existing MVP behavior (uploads/<key>),
// preserved byte-for-byte so files already on disk keep working after this
// module was introduced. Default and dev/self-host driver; see
// docs/adr/0008-object-storage.md.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver, StoredObject } from "./types";

// Every key this codebase actually writes ends in one of these two
// extensions (photos/estimate pages: `.jpg`; archived letters: `.html`).
// The local filesystem has nowhere to persist a content-type alongside raw
// bytes without inventing a sidecar-file scheme nobody asked for, so it's
// derived from the extension instead — honest for every real key this app
// produces, including ones written before this driver existed.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".html": "text/html",
};

function contentTypeForKey(key: string): string {
  return EXTENSION_CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

/**
 * @param rootDir Defaults to `process.cwd()/uploads` — the exact path every
 * write/read site already used before this module existed. Overridable only
 * for tests (a real, throwaway temp directory), never by the app itself.
 */
export function createLocalStorageDriver(rootDir: string = path.join(process.cwd(), "uploads")): StorageDriver {
  function resolve(key: string): string {
    return path.join(rootDir, key);
  }

  return {
    async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
      // contentType is intentionally not persisted — get() derives it from
      // the key's extension instead (see EXTENSION_CONTENT_TYPES above).
      void contentType;
      const filePath = resolve(key);
      await mkdir(path.dirname(filePath), { recursive: true });
      // Content-addressed keys (photos, estimate pages) make an overwrite of
      // identical bytes a safe no-op; letter keys are a fresh UUID per
      // issuance and never rewritten in practice (issueLetter refuses a
      // second call — "already_issued").
      await writeFile(filePath, bytes);
    },

    async get(key: string): Promise<StoredObject> {
      const bytes = await readFile(resolve(key));
      return { bytes, contentType: contentTypeForKey(key) };
    },

    async exists(key: string): Promise<boolean> {
      try {
        await access(resolve(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}
