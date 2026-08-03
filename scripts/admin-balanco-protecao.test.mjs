/**
 * Admin — Balanço Proteção (financeiro das proteções).
 * Marker: admin-balanco-protecao-v1
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
const MARKER = "admin-balanco-protecao-v1";

describe("Admin Balanço Proteção", () => {
  const page = read("deploy/vps-supabase/static/v2/admin-balanco-protecao.html");
  const shell = read("deploy/vps-supabase/static/v2/v2-shell.js");
  const v2 = read("deploy/vps-supabase/static/v2/v2.js");

  it("página carrega marker, gate de admin geral e abas pedidas", () => {
    assert.match(page, new RegExp(MARKER));
    assert.match(page, /arbishield-build" content="admin-balanco-protecao-v1"/);
    assert.match(page, /data-active="balanco-protecao"/);
    assert.match(page, /requireAdmin/);
    assert.doesNotMatch(page, /requireFinanceAdmin/);
    assert.match(page, /Depósitos PIX/);
    assert.match(page, /Transferências/);
    assert.match(page, /Movimentação/);
    assert.match(page, /Usuários/);
    assert.match(page, /Proteções \/ Eventos/);
    assert.match(page, /em andamento/);
    assert.match(page, /cancelad/i);
    assert.match(page, /Entrada/);
    assert.match(page, /Saída/);
    assert.match(page, /balanco-protecao-saida-exchange-v1/);
    assert.match(page, /exchangeWonDeduction/);
    assert.match(page, /buildExchangeFeeIndex/);
    assert.match(page, /fee_charged_cents/);
    assert.match(page, /valor deduzido/);
    assert.match(page, /ganhas na Exchange/);
    // Não usa stake nem comissão Exchange no KPI de saída
    assert.match(page, /Não soma stake devolvido nem exchange_commission/);
  });

  it("consulta depósitos reais, txs de proteção, lay/back e matches", () => {
    assert.match(page, /manual_deposits/);
    assert.match(page, /wallet_transactions/);
    assert.match(page, /protection_lock/);
    assert.match(page, /protection_settlement/);
    assert.match(page, /protection_refund/);
    assert.match(page, /\.from\("protections"\)/);
    assert.match(page, /\.from\("back_protections"\)/);
    assert.match(page, /\.from\("matches"\)/);
    assert.match(page, /locked_balance_cents/);
    assert.match(page, /deduction_balance_cents/);
    assert.match(page, /Saldo Reembolso/);
    // profiles-sem-coluna-email-v1
    assert.doesNotMatch(page, /profiles\([^)]*email/);
    assert.doesNotMatch(page, /\.select\([^)]*email/);
  });

  it("menu Operação aponta para a página e NÃO exige ACL Financeiro", () => {
    assert.match(shell, /"balanco-protecao"/);
    assert.match(shell, /Balanço Proteção/);
    assert.match(shell, /"\/admin-balanco-protecao\.html"/);
    const opIdx = shell.indexOf('title: "Operação"');
    const finIdx = shell.indexOf('title: "Financeiro"');
    const itemIdx = shell.indexOf('"balanco-protecao"');
    assert.ok(opIdx >= 0 && finIdx > opIdx, "seções Operação/Financeiro presentes");
    assert.ok(
      itemIdx > opIdx && itemIdx < finIdx,
      "Balanço Proteção deve ficar em Operação (visível a todos os admins)"
    );
    assert.doesNotMatch(v2, /"balanco-protecao"\s*:\s*1/);
  });
});
