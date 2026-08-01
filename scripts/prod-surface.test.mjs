/**
 * A superfície auditada tem que existir no repo — senão o auditor de desvio
 * silencia justamente onde a regressão acontece.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROD_ORIGIN,
  PROD_SURFACE,
  PROD_SURFACE_VERSION,
  isTextContentType,
  lineDelta,
  normalizeDeployedAsset,
} from "./lib/prod-surface.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("superfície de produção (prod-surface-v1)", () => {
  it("versão e origem", () => {
    assert.equal(PROD_SURFACE_VERSION, "prod-surface-v1");
    assert.equal(PROD_ORIGIN, "https://arbishield.app");
    assert.ok(PROD_SURFACE.length >= 10);
  });

  it("todo arquivo listado existe no repositório", () => {
    for (const [urlPath, repoPath] of PROD_SURFACE) {
      assert.ok(
        existsSync(resolve(root, repoPath)),
        `${urlPath} aponta para ${repoPath}, que não existe`
      );
    }
  });

  it("sem URL duplicada", () => {
    const urls = PROD_SURFACE.map(([u]) => u);
    assert.equal(new Set(urls).size, urls.length);
  });

  it("as páginas críticas do contrato estão cobertas", () => {
    const urls = new Set(PROD_SURFACE.map(([u]) => u));
    for (const page of [
      "/app-proteger.html",
      "/app-protecoes.html",
      "/app-carteira.html",
      "/admin-jogos.html",
      "/admin-manual-deposits.html",
      "/admin-monitoring-desafios.html",
    ]) {
      assert.ok(urls.has(page), `${page} fora da auditoria`);
    }
  });
});

describe("normalização do cache-bust", () => {
  it("ignora só o ?v= que o servidor reescreve", () => {
    const repo = '<script src="/v2.js?v=desafio-sem-radar-1"></script>';
    const live = '<script src="/v2.js?v=admin-hard-v1"></script>';
    assert.equal(normalizeDeployedAsset(repo), normalizeDeployedAsset(live));
  });

  it("não esconde diferença de verdade", () => {
    const a = normalizeDeployedAsset('<div class="a">x</div>');
    const b = normalizeDeployedAsset('<div class="b">x</div>');
    assert.notEqual(a, b);
  });

  it("content-type de texto × fallback do nginx", () => {
    assert.equal(isTextContentType("text/html; charset=utf-8"), true);
    assert.equal(isTextContentType("application/javascript"), true);
    assert.equal(isTextContentType("image/png"), false);
  });
});

describe("tamanho do desvio", () => {
  it("conteúdo igual dá zero", () => {
    assert.equal(lineDelta("<a>\n<b>\n", "<a>\n<b>\n"), 0);
  });

  it("uma linha trocada conta as duas pontas", () => {
    assert.equal(lineDelta("<a>\nx\n", "<a>\ny\n"), 2);
  });

  it("ignora indentação, linha vazia e o ?v= do servidor", () => {
    assert.equal(
      lineDelta('  <script src="/v2.js?v=um"></script>\n\n', '<script src="/v2.js?v=dois"></script>\n'),
      0
    );
  });

  it("linha a mais de um lado conta uma", () => {
    assert.equal(lineDelta("<a>\n", "<a>\n<b>\n"), 1);
  });
});

describe("o auditor documenta o próprio uso", () => {
  it("explica variáveis e código de saída", () => {
    const src = readFileSync(resolve(root, "scripts/audit-prod-drift.mjs"), "utf8");
    assert.match(src, /ARBISHIELD_MAINLINE_REF/);
    assert.match(src, /ARBISHIELD_ORIGIN/);
    assert.match(src, /process\.exit\(bad\.length \? 1 : 0\)/);
  });
});
