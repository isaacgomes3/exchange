#!/usr/bin/env node
/**
 * Exporta buckets/arquivos do Storage Supabase Cloud via API.
 * Uso: node scripts/supabase-export-storage.mjs <outdir>
 */
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const outDir = process.argv[2];
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!outDir || !url || !key) {
  console.error("Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/supabase-export-storage.mjs <outdir>");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${await res.text()}`);
  }
  return res;
}

const buckets = await (await api("/storage/v1/bucket")).json();
writeFileSync(join(outDir, "buckets.json"), JSON.stringify(buckets, null, 2));
console.log(`buckets: ${buckets.length}`);

async function listAll(bucket, prefix = "") {
  const res = await api(`/storage/v1/object/list/${bucket}`, {
    method: "POST",
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  return res.json();
}

async function walk(bucket, prefix = "", acc = []) {
  const items = await listAll(bucket, prefix);
  for (const item of items) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      await walk(bucket, path, acc);
    } else {
      acc.push(path);
    }
  }
  return acc;
}

for (const b of buckets) {
  const name = b.name;
  console.log(`→ ${name}`);
  const files = await walk(name);
  writeFileSync(join(outDir, `${name}.files.json`), JSON.stringify(files, null, 2));
  for (const file of files) {
    const dest = join(outDir, "objects", name, file);
    mkdirSync(dirname(dest), { recursive: true });
    const res = await api(`/storage/v1/object/${name}/${file}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    console.log(`  ok ${name}/${file}`);
  }
}

console.log("✓ storage export done");
