/**
 * Admin — Balanço Desafio (financeiro da Carteira Desafio).
 * Marker: admin-balanco-desafio-v1
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const MARKER = "admin-balanco-desafio-v1";

describe("Admin Balanço Desafio", () => {
  const page = read("deploy/vps-supabase/static/v2/admin-balanco-desafio.html");
  const shell = read("deploy/vps-supabase/static/v2/v2-shell.js");
  const v2 = read("deploy/vps-supabase/static/v2/v2.js");

  it("página carrega marker, ACL financeiro e abas pedidas", () => {
    assert.match(page, new RegExp(MARKER));
    assert.match(page, /arbishield-build" content="admin-balanco-desafio-v1"/);
    assert.match(page, /data-active="balanco-desafio"/);
    assert.match(page, /requireFinanceAdmin/);
    assert.match(page, /Depósitos PIX/);
    assert.match(page, /Transferências/);
    assert.match(page, /Movimentação/);
    assert.match(page, /Usuários/);
    assert.match(page, /Desafios \/ Eventos/);
    assert.match(page, /em andamento/);
    assert.match(page, /cancelados/i);
    assert.match(page, /Entrada/);
    assert.match(page, /Saída/);
  });

  it("consulta depósitos desafio, transferências, participações e saldos", () => {
    assert.match(page, /manual_deposits/);
    assert.match(page, /deposit_type/);
    assert.match(page, /desafio_balance_cents/);
    assert.match(page, /wallet_transactions/);
    assert.match(page, /internal_transfer/);
    assert.match(page, /desafio_participations/);
    assert.match(page, /desafio_steps/);
    assert.match(page, /desafio_deposit/);
    assert.match(page, /desafio_cancel_refund/);
    assert.match(page, /desafio_zebra_payout/);
    // profiles-sem-coluna-email-v1
    assert.doesNotMatch(page, /profiles\([^)]*email/);
    assert.doesNotMatch(page, /\.select\([^)]*email/);
  });

  it("menu Financeiro aponta para a página e ACL inclui o id", () => {
    assert.match(
      shell,
      /balanco-desafio["'].*Balanço Desafio.*admin-balanco-desafio\.html|Balanço Desafio.*balanco-desafio/
    );
    assert.match(shell, /"\/admin-balanco-desafio\.html"/);
    assert.match(v2, /"balanco-desafio"\s*:\s*1/);
  });
});
