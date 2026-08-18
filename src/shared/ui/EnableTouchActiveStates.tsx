"use client";

import { useEffect } from "react";

// iOS Safari does not apply `:active` styles to plain `<a>`/tap targets at
// all unless *some* touchstart listener exists anywhere on the page — a
// long-documented WebKit quirk (:active only "arms" once an element
// participates in the touch-event chain). Verified for real during this
// task's V3 motion pass: test/e2e/motion.spec.ts's pressed-state assertion
// passed on the `<button>` submit control under Playwright's mobile-safari
// (WebKit) project but failed on `.resultLink` (an `<a>`) — the exact
// pattern this quirk produces — until this listener was added. Without it,
// every pressed-state rule this pass just wrote (direction.md "Smooth, not
// decorative" #1: "every tap gets a visible response") would silently not
// fire on the primary field device (AGENTS.md: "on a phone" / iOS Safari,
// docs/adr/0002-offline-and-pwa.md). A no-op listener is the standard,
// documented fix — no new dependency, nothing it needs to actually do.
export function EnableTouchActiveStates() {
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);

  return null;
}
