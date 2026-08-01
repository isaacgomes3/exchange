#!/usr/bin/env node
/**
 * Utilitário da release usado pelo publicador na VPS.
 *
 *   release-cli.mjs guard  --current <sha> --target <sha> --status <ahead|behind|identical|diverged> [--force]
 *   release-cli.mjs verify --dir <dir>
 *   release-cli.mjs refs   --dir <dir>
 *
 * `guard` sai 0 quando pode publicar e 1 quando publicar seria regressão —
 * a decisão vive em lib/release-manifest.mjs e é coberta por teste.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANIFEST_FILE,
  decidePublish,
  missingRefs,
  verifyManifest,
} from "./lib/release-manifest.mjs";

function arg(name, fallback = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes("--" + name);

const command = process.argv[2];

if (command === "guard") {
  const verdict = decidePublish({
    current: arg("current") || null,
    target: arg("target") || null,
    compareStatus: arg("status") || null,
    force: has("force"),
  });
  console.log((verdict.allow ? "LIBERADO" : "BLOQUEADO") + ": " + verdict.reason);
  process.exit(verdict.allow ? 0 : 1);
}

if (command === "verify") {
  const dir = arg("dir");
  if (!dir) {
    console.error("uso: release-cli.mjs verify --dir <dir>");
    process.exit(2);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8"));
  } catch (err) {
    console.error(`sem ${MANIFEST_FILE} legível em ${dir}: ${err.message}`);
    process.exit(2);
  }
  const check = verifyManifest(dir, manifest);
  if (check.ok) {
    console.log(`manifesto OK · ${manifest.fileCount} arquivos · commit ${manifest.commit}`);
    process.exit(0);
  }
  console.error("manifesto NÃO confere:");
  for (const [label, list] of [
    ["faltando", check.missing],
    ["alterado", check.changed],
    ["sobrando", check.extra],
  ]) {
    if (list.length) console.error(`  ${label}: ${list.slice(0, 10).join(", ")}`);
  }
  process.exit(1);
}

if (command === "refs") {
  const dir = arg("dir");
  if (!dir) {
    console.error("uso: release-cli.mjs refs --dir <dir>");
    process.exit(2);
  }
  const broken = missingRefs(dir);
  if (!broken.length) {
    console.log("referencias OK · nenhum arquivo citado esta faltando");
    process.exit(0);
  }
  console.error("a release referencia arquivos que ela nao carrega:");
  for (const { ref, pages } of broken) {
    console.error(`  ${ref}  <- ${pages.slice(0, 4).join(", ")}`);
  }
  process.exit(1);
}

console.error("comandos: guard | verify | refs");
process.exit(2);
