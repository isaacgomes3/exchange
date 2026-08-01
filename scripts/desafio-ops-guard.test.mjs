/**
 * Desafio em andamento (ao vivo): liquida-se, não se cancela nem se exclui.
 *
 * Isaac/Carlos podem cancelar publicado/agendado (fora de andamento).
 * Marker: block-cancel-delete-andamento-v1 · protect-ops-isaac-carlos-v1
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

  it("carrega o marker em delete e cancel (e helper ao vivo)", () => {
    const n = (shim.match(new RegExp(MARKER, "g")) || []).length;
    assert.ok(n >= 2, `marker ${MARKER} deve aparecer ≥2 vezes (tem ${n})`);
    assert.match(shim, /async function deleteDesafio\([\s\S]*?block-cancel-delete-andamento-v1/);
    assert.match(shim, /async function cancelDesafio\([\s\S]*?block-cancel-delete-andamento-v1/);
  });

  it("excluir em andamento devolve 403", () => {
    assert.match(
      shim,
      /Não é permitido excluir desafio em andamento \(publicado\/ativo\)\./
    );
  });

  it("cancelar em andamento (ao vivo) devolve 403", () => {
    assert.match(
      shim,
      /Não é permitido cancelar desafio em andamento \(publicado\/ativo\)\./
    );
    assert.match(shim, /async function desafioHasLiveOpenStep\(/);
  });

  it("dentro de cancelDesafio, a guarda de andamento vem antes do estorno", () => {
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

  it("publicado/agendado só Isaac/Carlos cancelam", () => {
    assert.match(shim, /DESAFIO_CANCEL_OPS_ADMINS/);
    assert.match(shim, /isaacgomes3@gmail\.com/);
    assert.match(shim, /carlos@arbishield\.com/);
    assert.match(
      shim,
      /Só Isaac\/Carlos podem cancelar desafio publicado/
    );
  });
});

describe("UI: Cancelar para Isaac/Carlos fora de andamento", () => {
  const ui = read(UI);

  it("define em andamento como etapa ao vivo", () => {
    assert.match(ui, /function isDesafioEmAndamento\(/);
    assert.match(ui, /stepState\(s\) === "live"/);
  });

  it("Cancelar usa canShowCancelDesafio (Isaac/Carlos fora de andamento)", () => {
    assert.match(ui, /function canShowCancelDesafio\(/);
    assert.match(ui, /canShowCancelDesafio\(d\)/);
    assert.match(ui, /canManageProtectedDesafio\(\)/);
    assert.match(ui, /protect-ops-isaac-carlos-v1/);
  });

  it("Excluir continua bloqueado em ativo/publicado", () => {
    const del = ui.slice(
      ui.indexOf("hide-excluir-desafio-ativo-v1"),
      ui.indexOf("data-delete-desafio")
    );
    assert.match(del, /!isDesafioActiveOpen\(d\)/);
    assert.match(del, /!d\.is_active/);
  });

  it("explica ao admin quando Cancelar/Excluir estão bloqueados ao vivo", () => {
    assert.match(ui, /Em andamento · Cancelar\/Excluir bloqueados/);
    assert.match(ui, /isDesafioEmAndamento\(d\)/);
  });

  it("liquidar continua disponível — é o caminho certo em andamento", () => {
    assert.match(ui, /data-settle=/);
    assert.match(ui, /Empate Anula/);
  });
});
