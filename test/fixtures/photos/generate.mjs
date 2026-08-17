#!/usr/bin/env node
// One-time generator for the real JPEG fixtures used by
// test/e2e/offline-capture.spec.ts (setInputFiles needs a real, decodable
// image file — not a fake/empty path, per task instructions). No new
// dependency is added: Playwright's own bundled Chromium (already a
// devDependency, @playwright/test) renders a real <canvas> and exports it
// via canvas.toDataURL("image/jpeg"), which is genuine JPEG encoding done
// by the browser engine itself, not a hand-rolled or invented byte stream.
//
// Re-run with: node test/fixtures/photos/generate.mjs
// Committed output: sample-element.jpg, sample-exterior.jpg (both real,
// small, decodable JPEGs — a few KB each).
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function renderJpeg(label, color) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(
    ({ label, color }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.font = "24px sans-serif";
      ctx.fillText(label, 20, 120);
      return canvas.toDataURL("image/jpeg", 0.85);
    },
    { label, color },
  );
  await browser.close();
  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

const element = await renderJpeg("RiverLine test fixture — element", "#1a4480");
await writeFile(path.join(__dirname, "sample-element.jpg"), element);
console.log(`Wrote sample-element.jpg (${element.length} bytes)`);

const exterior = await renderJpeg("RiverLine test fixture — exterior", "#3d4551");
await writeFile(path.join(__dirname, "sample-exterior.jpg"), exterior);
console.log(`Wrote sample-exterior.jpg (${exterior.length} bytes)`);
