// T-G3: client-safe role data. Pure, zero-I/O, zero server dependency —
// lives in src/shared (not src/core/admin) specifically so a "use client"
// component (app/admin/users/_components/AddUserForm.tsx, UserRow.tsx) can
// import it directly. Boundary rule: app/* may only reach src/core/<family>
// through that family's index.ts (docs/adr/0003-module-boundary-enforcement.md),
// and src/core/admin/index.ts also re-exports queries.ts/actions.ts, which
// import src/shared/db -> the `pg` driver. `pg`'s connection-string parser
// unconditionally requires Node's `fs` module, which does not exist in a
// browser bundle — so ANY runtime (non-type-only) import from
// `@/core/admin`, even of an unrelated named export, breaks the client
// build ("Module not found: Can't resolve 'fs'", discovered running
// `pnpm test:users` against this exact page). src/shared/** has no such
// restriction (any file is importable directly, per eslint.config.mjs's
// boundaries settings) and is never allowed to import src/core/* (leaf),
// so this file is guaranteed to stay client-bundle-safe.
//
// src/core/admin/index.ts re-exports these same values for server-side
// consumers (app/admin/users/page.tsx, src/core/admin/actions.ts) — there
// is exactly one definition, never two.
export const ROLES = ["admin", "assessor", "official", "viewer"] as const;
export type UserRole = (typeof ROLES)[number];

/** Plain-language descriptions for the "Add a team member" form, so an
 * emergency manager who has never used this tool can pick the right role
 * without guessing. Text describes what each role can actually DO in this
 * app — derived directly from the requireRole(...) gates each destination
 * page/route already enforces (app/registry, app/capture, app/
 * determination, app/dashboard, app/letters, app/admin — grepped
 * 2026-08-18), not invented. Kept here as the one source both the form and
 * src/core/admin re-export from. */
export const ROLE_DESCRIPTIONS: Record<UserRole, { label: string; description: string }> = {
  admin: {
    label: "Administrator",
    description:
      "Full access. Manages team members, cost tables, and jurisdiction settings, plus everything an official can do. Give this to the emergency manager or their designated backup only.",
  },
  assessor: {
    label: "Assessor",
    description:
      "Field role. Finds a structure, captures a damage assessment (photos, measurements, element-by-element damage), and views the resulting calculation. Cannot review or adopt determinations, and has no access to the dashboard, letters, or administration.",
  },
  official: {
    label: "Official",
    description:
      "Review role. Reviews assessed structures in the determination queue, adopts (or contests) the substantial-damage determination, issues letters, and sees the administrator dashboard. This is the decision-maker of record for adoption. Cannot capture field assessments and has no access to administration.",
  },
  viewer: {
    label: "Viewer",
    description:
      "Read-only. Can look up a structure's record but cannot capture an assessment, review a determination, or change anything. Use for someone who only needs to look things up.",
  },
};
