// Ambient module declaration for global CSS side-effect imports
// (e.g. `import "./globals.css"` in app/layout.tsx). Next.js's webpack/
// Turbopack loader handles these at build time; tsc needs this declaration
// to type-check the import statement itself.
declare module "*.css";
