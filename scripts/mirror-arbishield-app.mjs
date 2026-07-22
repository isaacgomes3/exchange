#!/usr/bin/env node
/**
 * Baixa o build público de https://arbishield.app para ./arbishield-local
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "arbishield-local");
const ORIGIN = process.env.ARBISHIELD_REMOTE_ORIGIN ?? "https://arbishield.app";

async function fetchText(path) {
  const res = await fetch(`${ORIGIN}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

async function download(rel) {
  const clean = rel.replace(/[\\#]+$/g, "").replace(/^\//, "");
  const dest = join(outDir, clean);
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(`${ORIGIN}/${clean}`);
  if (!res.ok) {
    console.warn(`skip ${clean} (${res.status})`);
    return false;
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`ok ${clean}`);
  return true;
}

mkdirSync(outDir, { recursive: true });

let html = await fetchText("/");
html = html.replace(/\u0000/g, "");
html = html.replace(/<script[^>]*\/~flock\.js[^>]*>\s*<\/script>/gi, "");
html = html.replace(/\/assets\/main-[A-Za-z0-9_-]+\.css#/g, (m) => m.slice(0, -1));
if (!html.includes("<base ")) {
  html = html.replace("<head>", '<head>\n    <base href="/" />');
}
writeFileSync(join(outDir, "index.html"), html);

const mainJsName =
  (html.match(/\/assets\/(main-[A-Za-z0-9_-]+\.js)/) || [])[1] ||
  "main-D_khrzRh.js";
const indexJsName =
  (html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] ||
  "index-CO7o2g3n.js";

await download(`assets/${mainJsName}`);
await download(`assets/${indexJsName}`);

const mainJs = readFileSync(join(outDir, "assets", mainJsName), "utf8");
const indexJs = existsSync(join(outDir, "assets", indexJsName))
  ? readFileSync(join(outDir, "assets", indexJsName), "utf8")
  : "";

const assetRe =
  /assets\/[A-Za-z0-9_@.+-]+\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?|ico)|icons\/[A-Za-z0-9_.-]+\.(?:png|svg|ico)/g;
const assets = new Set([
  ...[...html.matchAll(/\/(assets\/[^"'#?\s]+|icons\/[^"'#?\s]+|manifest\.json)/g)].map(
    (m) => m[1]
  ),
  ...(mainJs.match(assetRe) || []),
  ...(indexJs.match(assetRe) || []),
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "__l5e/assets-v1/bb86157e-b44b-4509-970d-178ba8318729/desafio-banner-v3.png",
]);

for (const rel of [...assets].sort()) {
  await download(rel.replace(/[\\#]+$/g, ""));
}

writeFileSync(
  join(outDir, ".mirror-meta.json"),
  JSON.stringify(
    {
      origin: ORIGIN,
      mirroredAt: new Date().toISOString(),
      supabaseUrl: "https://wknyfxikmmvjzpbevlid.supabase.co",
    },
    null,
    2
  )
);

console.log(`\n✓ Mirror pronto em ${outDir}`);
