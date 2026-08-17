// Ambient module declaration for global CSS side-effect imports
// (e.g. `import "./globals.css"` in app/layout.tsx). Next.js's webpack/
// Turbopack loader handles these at build time; tsc needs this declaration
// to type-check the import statement itself.
declare module "*.css";

// Plain-JS migration/db scripts (scripts/db/*.mjs) imported directly by the
// RLS test suite (test/unit/db/rls.test.ts) to reuse the real
// applyMigrations/ensureDatabaseExists logic instead of duplicating it.
declare module "*.mjs";

// CSS Modules (e.g. app/login/page.module.css) — typed default export of
// class-name -> generated-class-name so `styles.foo` type-checks.
declare module "*.module.css" {
  const classes: { readonly [className: string]: string };
  export default classes;
}
