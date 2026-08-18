// Pluggable object storage — the interface every write/read site in this
// codebase goes through instead of touching the filesystem directly.
// See docs/adr/0008-object-storage.md for the driver-selection rationale.
//
// Keys are opaque strings, never filesystem paths in the interface's own
// terms (callers happen to build them with `/` separators today —
// content-hash-based for photos/estimate pages, `letters/<jid>/<id>.html`
// for letters — build spec §2.4's content-hash requirement, unchanged by
// this module). A driver decides what a key resolves to.

export interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export interface StorageDriver {
  /** Writes `bytes` under `key`, tagged with `contentType`. Writing the same
   * content-addressed key twice (a field-device retry) must be a safe
   * no-op/overwrite — never an error — matching the filesystem driver's
   * pre-existing behavior (AGENTS.md's idempotent-sync discipline). */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Reads `key` back. Throws if the key does not exist — callers already
   * wrap every read site in a try/catch that maps any error to 404, same as
   * the `readFile()` ENOENT behavior this interface replaces. */
  get(key: string): Promise<StoredObject>;
  /** True if `key` has been written. */
  exists(key: string): Promise<boolean>;
}
