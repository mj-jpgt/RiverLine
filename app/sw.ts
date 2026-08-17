// Service worker entry point, compiled by @serwist/next into public/sw.js.
//
// This is toolchain scaffolding only. It precaches the build output so the
// app shell loads offline. It does NOT implement the IndexedDB write queue
// for offline assessment capture (src/core/capture/) — that is a capture
// module concern, not a toolchain concern, and belongs in the M2 task.
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
