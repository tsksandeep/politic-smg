// build.mjs — bundle the MV3 node client with esbuild into extension/dist.
// Outputs: dist/background.js, dist/options.js, dist/options.html, dist/manifest.json, dist/icon128.png
//
// Usage: npm run build   (or `node build.mjs --watch`)

import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, "dist");
const watch = process.argv.includes("--watch");

async function copyStatic() {
  await cp(resolve(root, "manifest.json"), resolve(out, "manifest.json"));
  await cp(resolve(root, "src/options.html"), resolve(out, "options.html"));
  const icon = resolve(root, "icon128.png");
  if (existsSync(icon)) await cp(icon, resolve(out, "icon128.png"));
}

const buildOptions = {
  entryPoints: {
    background: resolve(root, "src/background.ts"),
    options: resolve(root, "src/options.ts"),
  },
  outdir: out,
  bundle: true,
  format: "esm",
  target: ["chrome116"],
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.rebuild();
  await copyStatic();
  await ctx.watch();
  console.log("[build] watching… dist/ is ready to load unpacked");
} else {
  await esbuild.build(buildOptions);
  await copyStatic();
  console.log("[build] done -> extension/dist");
}
