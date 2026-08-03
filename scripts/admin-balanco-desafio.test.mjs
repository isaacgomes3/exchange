/**
 * Admin — Balanço Desafio (financeiro da Carteira Desafio).
 * Marker: admin-balanco-desafio-v1
 *
 * Visível para TODOS os admins (Operação), não só allowlist Financeiro.
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

  it("página carrega marker, gate de admin geral e abas pedidas", () => {
    assert.match(page, new RegExp(MARKER));
    assert.match(page, /arbishield-build" content="admin-balanco-desafio-v1"/);
    assert.match(page, /data-active="balanco-desafio"/);
    assert.match(page, /requireAdmin/);
    assert.doesNotMatch(page, /requireFinanceAdmin/);
    assert.match(page, /Depósitos PIX/);
    assert.match(page, /Transferências/);
    assert.match(page, /Movimentação/);
    assert.match(page, /Usuários/);
    assert.match(page, /Desafios \/ Eventos/);
    assert.match(page, /em andamento/);
    assert.match(page, /cancelados/i);
    assert.match(page, /Entrada/);
    assert.match(page, /Saída/);
    // KPI de saída = só stake das apostas ganhas na Exchange (result Casa/lost)
    assert.match(page, /balanco-desafio-saida-exchange-v1/);
    assert.match(page, /exchangeWonStakeCents/);
    assert.match(page, /ganhas na Exchange/);
    assert.match(page, /normalizeResult\(p\.result\) === "lost"/);
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

  it("menu Operação aponta para a página e NÃO exige ACL Financeiro", () => {
    assert.match(shell, /"balanco-desafio"/);
    assert.match(shell, /Balanço Desafio/);
    assert.match(shell, /"\/admin-balanco-desafio\.html"/);
    // Item fica na seção Operação (antes do bloco Financeiro).
    const opIdx = shell.indexOf('title: "Operação"');
    const finIdx = shell.indexOf('title: "Financeiro"');
    const itemIdx = shell.indexOf('"balanco-desafio"');
    assert.ok(opIdx >= 0 && finIdx > opIdx, "seções Operação/Financeiro presentes");
    assert.ok(
      itemIdx > opIdx && itemIdx < finIdx,
      "Balanço Desafio deve ficar em Operação (visível a todos os admins)"
    );
    assert.doesNotMatch(v2, /"balanco-desafio"\s*:\s*1/);
  });
});
