#!/usr/bin/env node
/**
 * Monta a release do frontend: um diretório pronto para servir, com manifesto,
 * versão e cache-bust já aplicados.
 *
 * Uso:
 *   node scripts/build-release.mjs --out /tmp/release [--commit <sha>] [--source <repo>]
 *
 * Sem --commit, usa o HEAD do git. O token de cache-bust é o commit curto, então
 * cada release invalida o cache sozinha — sem `sed` no servidor.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_FILE,
  RELEASE_SOURCE_DIR,
  VERSION_FILE,
  applyCacheBust,
  buildManifest,
  buildVersionInfo,
  listReleaseFiles,
  sha256,
  verifyManifest,
} from "./lib/release-manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const source = resolve(arg("source", repoRoot));
const out = arg("out");
if (!out) {
  console.error("uso: build-release.mjs --out <dir> [--commit <sha>] [--source <repo>]");
  process.exit(2);
}
const outDir = resolve(out);

function resolveCommit() {
  const fromArg = arg("commit");
  if (fromArg) return fromArg.trim();
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
  } catch {
    console.error(
      "não foi possível descobrir o commit: passe --commit <sha> (fora de um clone git)"
    );
    process.exit(2);
  }
}

const commit = resolveCommit();
const cacheBust = commit.slice(0, 12);
const sourceDir = join(source, ...RELEASE_SOURCE_DIR.split("/"));

try {
  if (!statSync(sourceDir).isDirectory()) throw new Error("não é diretório");
} catch {
  console.error(`origem inexistente: ${sourceDir}`);
  process.exit(2);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(sourceDir, outDir, { recursive: true });
for (const generated of [MANIFEST_FILE, VERSION_FILE]) {
  rmSync(join(outDir, generated), { force: true });
}

const files = {};
let busted = 0;
for (const rel of listReleaseFiles(outDir)) {
  const abs = join(outDir, ...rel.split(posix.sep));
  if (rel.endsWith(".html")) {
    const original = readFileSync(abs, "utf8");
    const next = applyCacheBust(original, cacheBust);
    if (next !== original) {
      writeFileSync(abs, next);
      busted += 1;
    }
  }
  files[rel] = sha256(readFileSync(abs));
}

const manifest = buildManifest({ commit, files, cacheBust });
writeFileSync(join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(
  join(outDir, VERSION_FILE),
  JSON.stringify(buildVersionInfo(manifest), null, 2) + "\n"
);

const check = verifyManifest(outDir, manifest);
if (!check.ok) {
  console.error("manifesto não confere com o disco logo após o build:");
  console.error(JSON.stringify(check, null, 2));
  process.exit(1);
}

console.log(`release ${cacheBust} · ${manifest.fileCount} arquivos · ${busted} HTML com cache-bust`);
console.log(`  commit ${commit}`);
console.log(`  destino ${outDir}`);
