/**
 * Desafio em andamento: liquida-se, não se cancela nem se exclui.
 *
 * A trava existia numa linhagem e não na outra; publicar a linhagem sem ela
 * devolveu o botão "Cancelar · devolver saldo" para desafios em andamento.
 * Marker: block-cancel-delete-andamento-v1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

const MARKER = "block-cancel-delete-andamento-v1";
const UI = "deploy/vps-supabase/static/v2/admin-desafios.html";
const SHIM = "scripts/arbishield-serverfn-shim.mjs";

describe("API recusa cancelar/excluir desafio em andamento", () => {
  const shim = read(SHIM);

  it("carrega o marker nas duas operações", () => {
    assert.equal((shim.match(new RegExp(MARKER, "g")) || []).length, 2);
  });

  it("excluir em andamento devolve 403", () => {
    assert.match(
      shim,
      /Não é permitido excluir desafio em andamento \(publicado\/ativo\)\./
    );
  });

  it("cancelar em andamento devolve 403", () => {
    assert.match(
      shim,
      /Não é permitido cancelar desafio em andamento \(publicado\/ativo\)\./
    );
  });

  it("dentro de cancelDesafio, a guarda vem antes do estorno", () => {
    const start = shim.indexOf("async function cancelDesafio(");
    assert.ok(start > 0, "cancelDesafio não encontrada");
    const end = shim.indexOf("\nasync function ", start + 1);
    const body = shim.slice(start, end > 0 ? end : undefined);

    const guard = body.indexOf("Não é permitido cancelar desafio em andamento");
    const refund = body.indexOf("listPendingDesafioParticipations(id)");
    assert.ok(guard > 0, "guarda ausente em cancelDesafio");
    assert.ok(refund > 0, "estorno ausente em cancelDesafio");
    assert.ok(guard < refund, "estorno não pode rodar antes da guarda");
  });
});

describe("liquidar não depende de coluna opcional", () => {
  const shim = read(SHIM);

  it("o settle grava via patchDesafioStep, não sb() direto", () => {
    const start = shim.indexOf("async function settleDesafioStep(");
    assert.ok(start > 0);
    const end = shim.indexOf("\nasync function ", start + 1);
    const body = shim.slice(start, end > 0 ? end : undefined);
    assert.match(body, /await patchDesafioStep\(stepId, \{/);
    assert.doesNotMatch(
      body,
      /sb\(`\/rest\/v1\/desafio_steps\?id=eq[\s\S]{0,200}metadata:/,
      "PATCH direto com metadata volta a quebrar o settle onde a coluna não existe"
    );
  });

  it("o helper cai para sem metadata em vez de falhar", () => {
    assert.match(shim, /desafio-steps-metadata-opcional-v1/);
    const start = shim.indexOf("async function patchDesafioStep(");
    const body = shim.slice(start, shim.indexOf("async function sb(path,"));
    assert.match(body, /isMissingColumnError\(err, "metadata"\)/);
    assert.match(body, /desafioStepsHasMetadata = false/);
    assert.match(body, /delete rest\.metadata/);
  });

  it("erro que não é de coluna ausente continua estourando", () => {
    const start = shim.indexOf("async function patchDesafioStep(");
    const body = shim.slice(start, shim.indexOf("async function sb(path,"));
    assert.match(body, /if \(!isMissingColumnError\(err, "metadata"\)\) throw err;/);
  });

  it("cobre os dois formatos de coluna ausente", () => {
    const start = shim.indexOf("function isMissingColumnError(");
    const body = shim.slice(start, shim.indexOf("async function patchDesafioStep("));
    // SELECT devolve 42703 "does not exist"; a escrita devolve PGRST204
    // "Could not find ... in the schema cache". Cobrir só um deixa o settle quebrado.
    assert.match(body, /PGRST204/);
    assert.match(body, /42703/);
    assert.match(body, /does not exist/);
    assert.match(body, /schema cache/);
  });

  it("sb() repassa o código do erro para quem trata", () => {
    const start = shim.indexOf("async function sb(path,");
    const body = shim.slice(start, start + 1600);
    assert.match(body, /err\.code = String\(data\.code\)/);
  });
});

describe("UI esconde Cancelar/Excluir em andamento", () => {
  const ui = read(UI);

  it("os dois botões checam is_active e isDesafioActiveOpen", () => {
    const cancel = ui.slice(
      ui.indexOf(MARKER),
      ui.indexOf("data-cancel-desafio")
    );
    assert.match(cancel, /!isDesafioActiveOpen\(d\)/);
    assert.match(cancel, /!d\.is_active/);

    const del = ui.slice(
      ui.indexOf("hide-excluir-desafio-ativo-v1"),
      ui.indexOf("data-delete-desafio")
    );
    assert.match(del, /!isDesafioActiveOpen\(d\)/);
    assert.match(del, /!d\.is_active/);
  });

  it("explica ao admin por que os botões sumiram", () => {
    assert.match(ui, /Em andamento · Cancelar\/Excluir bloqueados/);
  });

  it("Isaac/Carlos seguem podendo cancelar protegido que não está em andamento", () => {
    assert.match(ui, /canManageProtectedDesafio\(\)/);
    assert.match(ui, /protect-ops-isaac-carlos-v1/);
  });

  it("liquidar continua disponível — é o caminho certo em andamento", () => {
    assert.match(ui, /data-settle=/);
    assert.match(ui, /Empate Anula/);
  });
});
