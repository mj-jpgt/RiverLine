// Flat config (ESLint 9). eslint-config-next 15.5.23 does not yet ship a
// flat-config export of its own (peer range is eslint ^7||^8||^9 — ESLint 10
// is not yet supported by eslint-config-next as of 2026-08-17, see
// docs/adr/0001-toolchain-and-versions.md), so we bridge it via FlatCompat,
// which is the pattern Next.js's own docs and the wider ecosystem use today.
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Local, dependency-free rule: reject raw hex colors and Tailwind arbitrary
 * values (`w-[347px]`, `text-[#3b82f6]`) in src/. AGENTS.md and
 * docs/agents/SUBAGENT.md both hard-fail these; tokens.css is the only
 * source of color/spacing/radius/type once it exists. This is a plain
 * object rule defined inline so no new lint-plugin dependency is needed for
 * one narrow check.
 */
const HEX_COLOR_RE = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/;
const ARBITRARY_TAILWIND_RE = /(?:^|\s)[a-zA-Z0-9-]+-\[[^\]\s]+\]/;

const riverlineLocalPlugin = {
  rules: {
    "no-raw-color-or-arbitrary-value": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow raw hex colors and Tailwind arbitrary values; use docs/design/tokens.css tokens only.",
        },
        schema: [],
        messages: {
          hex: "Raw hex color '{{value}}' is not allowed. Use a token from docs/design/tokens.css.",
          arbitrary:
            "Arbitrary Tailwind value in '{{value}}' is not allowed. Use a token-backed utility class instead.",
        },
      },
      create(context) {
        function check(node, raw) {
          if (typeof raw !== "string") return;
          if (HEX_COLOR_RE.test(raw)) {
            context.report({ node, messageId: "hex", data: { value: raw } });
            return;
          }
          if (ARBITRARY_TAILWIND_RE.test(raw)) {
            context.report({ node, messageId: "arbitrary", data: { value: raw } });
          }
        }
        return {
          Literal(node) {
            check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.raw);
          },
        };
      },
    },
  },
};

const config = [
  js.configs.recommended,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "public/sw.js",
      "public/sw.js.map",
      // Vendored tesseract.js worker/core assets, self-hosted for CSP
      // compliance (ADR 0007). Minified third-party code — not ours to lint.
      "public/tesseract-assets/**",
      "playwright-report/**",
      "test-results/**",
      "*.tsbuildinfo",
    ],
  },
  {
    // Module-boundary enforcement. See docs/adr/0003-module-boundary-enforcement.md.
    files: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "app/**" },
        { type: "core", pattern: "src/core/*/**", capture: ["family"] },
        { type: "modules", pattern: "src/modules/*/**", capture: ["family"] },
        { type: "shared", pattern: "src/shared/**" },
      ],
    },
    rules: {
      // Modern boundaries v7 API (the older "element-types"/"entry-point"
      // rules still work but are deprecated and, in testing, the legacy
      // "entry-point" rule's default scoping didn't compose cleanly with a
      // per-target allow — see docs/adr/0003-module-boundary-enforcement.md
      // for the two rules AGENTS.md requires and how this expresses them).
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message:
            "{{ from.element.type }} may not import {{ to.element.type }} ({{ to.source }}). See docs/adr/0003-module-boundary-enforcement.md.",
          policies: [
            // app: may use shared and modules freely; may reach into core
            // only through a core family's index.ts entry point.
            { from: { element: { type: "app" } }, allow: { to: { element: { type: "shared" } } } },
            { from: { element: { type: "app" } }, allow: { to: { element: { type: "modules" } } } },
            {
              from: { element: { type: "app" } },
              allow: { to: { element: { type: "core", fileInternalPath: "src/core/*/index.ts" } } },
            },
            // modules/<x>: may use shared; may reach core only through its
            // index.ts; may import its OWN family (self-imports), never a
            // different module family (AGENTS.md: "src/modules/<x> may not
            // import from src/modules/<y>").
            { from: { element: { type: "modules" } }, allow: { to: { element: { type: "shared" } } } },
            {
              from: { element: { type: "modules" } },
              allow: { to: { element: { type: "core", fileInternalPath: "src/core/*/index.ts" } } },
            },
            {
              from: { element: { type: "modules" } },
              allow: {
                to: {
                  element: {
                    type: "modules",
                    captured: { family: "{{ from.element.captured.family }}" },
                  },
                },
              },
            },
            // core/<x>: may use shared; may reach a DIFFERENT core family
            // only through its index.ts. Same-family internal files are not
            // boundary-checked at all (checkInternals defaults off), so
            // src/core/auth/*.ts can freely import each other.
            { from: { element: { type: "core" } }, allow: { to: { element: { type: "shared" } } } },
            {
              from: { element: { type: "core" } },
              allow: { to: { element: { type: "core", fileInternalPath: "src/core/*/index.ts" } } },
            },
            // src/shared/**: leaf. Nothing to allow — default disallow holds.
          ],
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { riverline: riverlineLocalPlugin },
    rules: {
      "riverline/no-raw-color-or-arbitrary-value": "error",
    },
  },
];

export default config;
