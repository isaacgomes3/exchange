#!/usr/bin/env node
/**
 * Auditor de desvio: o que está no ar × o que está no git.
 *
 * Responde a pergunta que hoje ninguém consegue responder — "qual versão está
 * publicada?" — comparando cada arquivo servido em produção com o conteúdo de
 * todas as branches do repositório.
 *
 * Uso:
 *   node scripts/audit-prod-drift.mjs
 *   ARBISHIELD_MAINLINE_REF=origin/main node scripts/audit-prod-drift.mjs
 *   ARBISHIELD_ORIGIN=https://teste.arbishield.app node scripts/audit-prod-drift.mjs
 *
 * Sai com código 1 se algum arquivo estiver divergente (não existe em branch
 * nenhuma) ou atrasado em relação à referência de mainline.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROD_ORIGIN,
  PROD_SURFACE,
  isTextContentType,
  lineDelta,
  normalizeDeployedAsset,
} from "./lib/prod-surface.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = (process.env.ARBISHIELD_ORIGIN || PROD_ORIGIN).replace(/\/$/, "");
const mainlineRef = process.env.ARBISHIELD_MAINLINE_REF || "origin/main";

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function gitShow(ref, path) {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

function digest(text) {
  return createHash("sha256").update(normalizeDeployedAsset(text)).digest("hex");
}

const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s && !s.endsWith("/HEAD"));

/** Data do último commit de cada branch, para dizer "atrasado desde quando". */
const branchDate = new Map(
  git([
    "for-each-ref",
    "--format=%(refname:short)\t%(committerdate:short)",
    "refs/remotes/origin",
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
);

async function fetchDeployed(urlPath) {
  const res = await fetch(origin + urlPath, {
    headers: { "cache-control": "no-cache" },
    redirect: "follow",
  });
  const contentType = res.headers.get("content-type");
  const body = await res.text();
  return { status: res.status, contentType, body };
}

const rows = [];
for (const [urlPath, repoPath] of PROD_SURFACE) {
  const row = { urlPath, repoPath, status: "", detail: "", bad: false };
  let deployed;
  try {
    deployed = await fetchDeployed(urlPath);
  } catch (err) {
    row.status = "SEM RESPOSTA";
    row.detail = err.message;
    row.bad = true;
    rows.push(row);
    continue;
  }

  if (deployed.status !== 200) {
    row.status = "HTTP " + deployed.status;
    row.bad = true;
    rows.push(row);
    continue;
  }
  if (!isTextContentType(deployed.contentType)) {
    // nginx devolvendo o fallback SPA em vez do arquivo pedido
    row.status = "NAO SERVIDO";
    row.detail = "content-type " + deployed.contentType;
    row.bad = true;
    rows.push(row);
    continue;
  }

  const liveHash = digest(deployed.body);
  const matches = branches.filter((b) => {
    const blob = gitShow(b, repoPath);
    return blob != null && digest(blob) === liveHash;
  });

  const mainlineBlob = gitShow(mainlineRef, repoPath);
  const mainlineHash = mainlineBlob == null ? null : digest(mainlineBlob);

  if (mainlineHash != null && mainlineHash === liveHash) {
    row.status = "OK";
    row.detail = "igual a " + mainlineRef;
  } else if (matches.length === 0) {
    // Dizer o tamanho do desvio e de onde ele mais se aproxima — sem isso, o
    // operador não sabe se são 2 linhas ou um arquivo inteiro.
    let closest = null;
    let closestDelta = Infinity;
    for (const branch of branches) {
      const blob = gitShow(branch, repoPath);
      if (blob == null) continue;
      const delta = lineDelta(blob, deployed.body);
      if (delta < closestDelta) {
        closestDelta = delta;
        closest = branch;
      }
    }
    row.status = "DESVIO";
    const pieces = ["conteudo no ar nao existe em nenhuma branch"];
    if (closest) {
      pieces.push(
        `+/- ${closestDelta} linha(s) de ${closest} (${branchDate.get(closest) || "?"})`
      );
    }
    if (mainlineBlob != null) {
      pieces.push(`+/- ${lineDelta(mainlineBlob, deployed.body)} linha(s) de ${mainlineRef}`);
    }
    row.detail = pieces.join(" · ");
    row.bad = true;
  } else if (mainlineHash == null) {
    row.status = "SEM FONTE";
    row.detail =
      mainlineRef +
      " nao tem esse arquivo · no ar = " +
      matches
        .slice(0, 3)
        .map((b) => `${b} (${branchDate.get(b) || "?"})`)
        .join(", ");
    row.bad = true;
  } else {
    row.status = "ATRASADO";
    row.detail =
      "no ar = " +
      matches
        .slice(0, 3)
        .map((b) => `${b} (${branchDate.get(b) || "?"})`)
        .join(", ");
    row.bad = true;
  }
  rows.push(row);
}

const width = Math.max(...rows.map((r) => r.urlPath.length));
console.log(`\nAuditoria de desvio · ${origin} · mainline=${mainlineRef}\n`);
for (const r of rows) {
  console.log(
    "  " + r.urlPath.padEnd(width) + "  " + r.status.padEnd(12) + "  " + r.detail
  );
}

const bad = rows.filter((r) => r.bad);
const drift = rows.filter((r) => r.status === "DESVIO");
console.log(
  `\n  ${rows.length} arquivos · ${rows.length - bad.length} OK · ${bad.length} com problema · ${drift.length} editados fora do git\n`
);
if (drift.length) {
  console.log(
    "  DESVIO significa que alguém editou em produção e nunca voltou ao repositório."
  );
  console.log(
    "  Rodar qualquer hotfix vai sobrescrever isso com a versão da branch dele.\n"
  );
}
process.exit(bad.length ? 1 : 0);
