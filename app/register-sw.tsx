"use client";

import { useEffect } from "react";

// No prior code in this repo ever registered app/sw.ts's compiled output
// (public/sw.js) from the browser — docs/adr/0002-offline-and-pwa.md wired
// up the Serwist *build*, but @serwist/next does not auto-inject client
// registration (confirmed: no such export exists in node_modules/@serwist/next).
// Without this, the precache manifest is built but never installed, so
// "/capture/* loads offline after first visit" (specs/core/tasks.md T-C3)
// would silently not work despite next.config.ts/app/sw.ts looking correct.
// Registration only runs in production — next.config.ts disables Serwist
// entirely in development (`disable: process.env.NODE_ENV === "development"`),
// so registering against a nonexistent /sw.js in dev would just be noise.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      console.error("[sw] registration failed:", err);
    });
  }, []);

  return null;
}
