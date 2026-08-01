/**
 * Publicação versionada do backend (shim-release-v1).
 *
 * O shim rodava de `/opt/arbishield/scripts/` enquanto uma cópia mais nova
 * dormia na raiz — "atualizar o backend" não mudava o que executava, e não
 * havia como saber por HTTP qual versão estava no ar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const SHIM = read("scripts/arbishield-serverfn-shim.mjs");
const PUB = read("scripts/vps-publish-shim.sh");

describe("shim expõe o commit publicado", () => {
  it("lê o sidecar .shim-release.json", () => {
    assert.match(SHIM, /shim-release-v1/);
    assert.match(SHIM, /\.shim-release\.json/);
  });

  it("sem sidecar não quebra — cai em null", () => {
    const start = SHIM.indexOf("let SHIM_RELEASE = null;");
    const block = SHIM.slice(start, start + 500);
    assert.match(block, /try \{/);
    assert.match(block, /\} catch \{/);
  });

  it("o health carrega o campo release", () => {
    const start = SHIM.indexOf('url.pathname === "/health"');
    assert.ok(start > 0, "handler de /health não encontrado");
    const block = SHIM.slice(start, start + 900);
    assert.match(block, /release: SHIM_RELEASE \|\| null/);
    assert.match(block, /createProtectionModel/);
    assert.match(block, /protectionFlowContract/);
  });
});

describe("publicador do backend: ordem das salvaguardas", () => {
  const at = (needle) => {
    const i = PUB.indexOf(needle);
    assert.ok(i > 0, `não achei "${needle}" no publicador`);
    return i;
  };

  it("publica no caminho que o systemd executa", () => {
    assert.match(PUB, /RUN_DIR="\$SHIM_DIR\/scripts"/);
    assert.match(PUB, /o que o systemd executa/);
  });

  it("guarda de regressão antes de qualquer instalação", () => {
    assert.ok(at("release-cli.mjs\" guard") < at("5/7 backup"));
    assert.match(PUB, /exit 3/);
  });

  it("node --check antes de trocar arquivo", () => {
    assert.ok(at("node --check \"$NEW_SHIM\"") < at("cp -f \"$NEW_SHIM\""));
  });

  it("backup antes da troca", () => {
    assert.ok(at("snapshot \"$BK\"") < at("cp -f \"$NEW_SHIM\""));
  });

  it("verifica health depois do restart e volta sozinho se ruim", () => {
    assert.ok(at("restart_service") < at("7/7 verificando health"));
    const tail = PUB.slice(at("7/7 verificando health"));
    assert.match(tail, /restore "\$BK"/);
    assert.match(tail, /exit 7/);
  });

  it("health só passa com o modelo vigente do contrato", () => {
    const block = PUB.slice(at("health_ok()"), at("wait_health()"));
    assert.match(block, /stake_lock_v1/);
    assert.match(block, /protectionFlowContract/);
  });

  it("grava o sidecar para a próxima publicação ter referência", () => {
    assert.match(PUB, /shim-release-v1/);
    assert.match(PUB, /"commit": "\$TARGET"/);
  });

  it("sincroniza as cópias paralelas para grep não mentir", () => {
    assert.match(PUB, /Cópias paralelas existiam e faziam grep mentir/);
  });

  it("tem dry-run, rollback e list", () => {
    for (const flag of ["--dry-run", "--rollback", "--list", "--force"]) {
      assert.ok(PUB.includes(flag), `falta ${flag}`);
    }
  });
});
