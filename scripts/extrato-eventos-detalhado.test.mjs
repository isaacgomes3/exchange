/**
 * Extrato detalhado de eventos — cliente e admin.
 * Marker: extrato-eventos-detalhado-v1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const MARKER = "extrato-eventos-detalhado-v1";

describe("Cliente: extrato de eventos detalhado", () => {
  const fin = read("deploy/vps-supabase/static/v2/v2-financeiro.js");
  const ui = read("deploy/vps-supabase/static/v2/app-carteira.html");

  it("carrega o marker e lista wallet txs de proteção/desafio/admin", () => {
    assert.match(fin, new RegExp(MARKER));
    assert.match(fin, /WALLET_TX_GROUP/);
    assert.match(fin, /protection_lock/);
    assert.match(fin, /protection_settlement/);
    assert.match(fin, /protection_refund/);
    assert.match(fin, /Cancelamento pelo admin/);
    assert.match(fin, /Dedução do evento/);
  });

  it("UI expõe filtros de Eventos, Desafio e Ajustes admin", () => {
    assert.match(ui, new RegExp(MARKER));
    assert.match(ui, /Eventos \/ Proteções/);
    assert.match(ui, /Ajustes admin/);
    assert.match(ui, /entradas e saídas dos eventos/);
  });
});

describe("Admin: mesma movimentação no drawer e na lista", () => {
  const users = read("deploy/vps-supabase/static/v2/admin-users.html");
  const txs = read("deploy/vps-supabase/static/v2/admin-transactions.html");
  const pages = read("deploy/vps-supabase/static/v2/v2-pages.js");

  it("admin-users tem Extrato / Movimentação no drawer", () => {
    assert.match(users, new RegExp(MARKER));
    assert.match(users, /udExtrato/);
    assert.match(users, /loadUserExtrato/);
    assert.match(users, /cancelado pelo admin/);
  });

  it("admin-transactions amplia o ledger e descreve cancel admin", () => {
    assert.match(txs, new RegExp(MARKER));
    assert.match(txs, /limit:\s*2000/);
    assert.match(pages, /Cancelamento pelo admin/);
    assert.match(pages, /admin_adjustment_credit/);
  });
});
