/**
 * Release versionada do frontend — contrato do artefato.
 *
 * O que fecha o buraco das regressões:
 *   1. um artefato por commit, com sha256 de cada arquivo (`__manifest.json`);
 *   2. o commit publicado exposto em `__version.json` (dá para consultar por HTTP);
 *   3. cache-bust gerado no build, não com `sed` no servidor;
 *   4. `decidePublish()` recusa publicar commit que não seja descendente do que
 *      já está no ar — é o que torna "pegar versão antiga" impossível.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

export const RELEASE_CONTRACT_VERSION = "release-artifact-v1";

/** Diretório do repo que vira a raiz servida pelo nginx. */
export const RELEASE_SOURCE_DIR = "deploy/vps-supabase/static/v2";

export const MANIFEST_FILE = "__manifest.json";
export const VERSION_FILE = "__version.json";

/** Gerados pelo build — nunca entram no próprio manifesto. */
export const GENERATED_FILES = [MANIFEST_FILE, VERSION_FILE];

/** Extensões que recebem cache-bust por release. */
const BUSTABLE = /\.(?:js|mjs|css)$/;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Caminhos relativos (posix, ordenados) de tudo que vai para a release. */
export function listReleaseFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(dir, abs).split(sep).join(posix.sep);
      if (GENERATED_FILES.includes(rel)) continue;
      out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Troca `?v=...` das referências locais de js/css pelo token da release.
 * Referência sem query também recebe o token — a release inteira invalida junto.
 */
export function applyCacheBust(text, token) {
  const bust = String(token || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!bust) return String(text);
  return String(text).replace(
    /((?:src|href)=")(\/[^"?#]+)(\?[^"#]*)?(#[^"]*)?"/g,
    (full, attr, path, _query, hash) => {
      if (!BUSTABLE.test(path)) return full;
      return `${attr}${path}?v=${bust}${hash || ""}"`;
    }
  );
}

export function buildManifest({ commit, files, builtAt, cacheBust }) {
  if (!commit) throw new Error("manifesto exige commit");
  return {
    contract: RELEASE_CONTRACT_VERSION,
    commit,
    cacheBust: cacheBust || commit.slice(0, 12),
    builtAt: builtAt || new Date().toISOString(),
    fileCount: Object.keys(files).length,
    files,
  };
}

export function buildVersionInfo(manifest, extra = {}) {
  return {
    contract: RELEASE_CONTRACT_VERSION,
    commit: manifest.commit,
    cacheBust: manifest.cacheBust,
    builtAt: manifest.builtAt,
    fileCount: manifest.fileCount,
    manifestSha256: sha256(Buffer.from(JSON.stringify(manifest.files))),
    ...extra,
  };
}

/** Confere no disco o que o manifesto promete. */
export function verifyManifest(dir, manifest) {
  const missing = [];
  const changed = [];
  for (const [rel, expected] of Object.entries(manifest.files || {})) {
    const abs = join(dir, ...rel.split(posix.sep));
    let st = null;
    try {
      st = statSync(abs);
    } catch {
      missing.push(rel);
      continue;
    }
    if (!st.isFile()) {
      missing.push(rel);
      continue;
    }
    if (sha256(readFileSync(abs)) !== expected) changed.push(rel);
  }
  const onDisk = new Set(listReleaseFiles(dir));
  const extra = [...onDisk].filter((rel) => !(rel in (manifest.files || {}))).sort();
  return { ok: !missing.length && !changed.length && !extra.length, missing, changed, extra };
}

/**
 * Pode publicar `target` em cima de `current`?
 *
 * `compareStatus` vem da API de compare do GitHub (base=current, head=target):
 * "ahead" | "behind" | "identical" | "diverged".
 */
export function decidePublish({ current, target, compareStatus, force } = {}) {
  if (!target) return { allow: false, reason: "sem commit alvo" };
  if (force) {
    return { allow: true, reason: "override explícito (force)", forced: true };
  }
  if (!current) {
    return { allow: true, reason: "primeira publicação — nada no ar para comparar" };
  }
  if (current === target) {
    return { allow: true, reason: "mesmo commit já publicado (republicação)" };
  }
  switch (compareStatus) {
    case "ahead":
      return { allow: true, reason: "alvo é descendente do publicado" };
    case "identical":
      return { allow: true, reason: "conteúdo idêntico ao publicado" };
    case "behind":
      return {
        allow: false,
        reason: "alvo é ANTERIOR ao que está no ar — publicar seria regressão",
      };
    case "diverged":
      return {
        allow: false,
        reason: "alvo e publicado divergiram — não há linha reta entre eles",
      };
    default:
      return {
        allow: false,
        reason: `não foi possível comparar com o publicado (status=${compareStatus || "desconhecido"})`,
      };
  }
}
