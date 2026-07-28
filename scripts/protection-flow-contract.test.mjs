/**
 * Regressão do fluxo de proteção — falha o CI se alguém alterar as regras
 * sem atualizar este contrato de propósito (e sem pedido explícito).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROTECTION_FLOW_CONTRACT_VERSION,
  PROTECTION_FLOW_LOCK,
  calcFeeUpfront,
  calcLay,
  calcBack,
  settlementCreditParts,
  settlementDeductionCents,
  creditBucketForSettlement,
  settlementStatusForOutcome,
  isFeeUpfrontProtection,
  isLockedMarginProtection,
  isVoidSettleOutcome,
  normalizeSettleOutcome,
  settlementCreditBucket,
} from "./lib/protection-flow-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("contrato travado — metadados", () => {
  it("mantém versão e lock", () => {
    assert.equal(PROTECTION_FLOW_CONTRACT_VERSION, "protection-flow-contract-v4");
    assert.equal(
      PROTECTION_FLOW_LOCK,
      "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST"
    );
  });

  it("AGENTS.md cita o lock do fluxo", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    assert.match(agents, /DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(agents, /protection-flow-contract-v4/);
    assert.match(agents, /Saldo Reembolso/);
    assert.match(agents, /Empate Anula/);
  });

  it("carteira do cliente exibe Saldo Reembolso (não Saldo Dedução)", () => {
    const html = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-carteira.html"),
      "utf8"
    );
    assert.match(html, /Saldo Reembolso/);
    assert.doesNotMatch(html, /Saldo Dedução/);
    assert.match(html, /v2-financeiro\.js\?v=saldo-reembolso-render-2/);
  });

  it("carrega Saldo Reembolso isoladamente após fallback do perfil", () => {
    const financeiro = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/v2-financeiro.js"),
      "utf8"
    );
    assert.match(
      financeiro,
      /\.select\("deduction_balance_cents"\)\s*\.eq\("id", userId\)\s*\.maybeSingle\(\)/
    );
    assert.match(
      financeiro,
      /state\.profile\.deduction_balance_cents\s*=\s*deductionRes\.data\.deduction_balance_cents/
    );
  });

  it("prelive e shim importam o contrato (não reimplementam settle credit)", () => {
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    assert.match(prelive, /protection-flow-contract\.mjs/);
    assert.match(shim, /protection-flow-contract\.mjs/);
    assert.match(prelive, /PROTECTION_FLOW_LOCK/);
    assert.match(shim, /PROTECTION_FLOW_LOCK/);
    // Não pode haver redefinição local das regras travadas
    assert.doesNotMatch(
      prelive,
      /function settlementCreditParts\s*\(/
    );
    assert.doesNotMatch(shim, /function settlementCreditParts\s*\(/);
  });
});

describe("locked_margin_v2 — cálculo", () => {
  it("LAY @ 20 resp. R$1000 → margem conhecida", () => {
    // back equiv = 20/19 ≈ 1.052631… (só cálculo; odd persistida = 20)
    const c = calcLay(100_000, 20);
    assert.equal(c.input_mode, "responsabilidade");
    assert.equal(c.odd, 20);
    assert.equal(c.marketOdd, 20);
    assert.ok(Math.abs(c.effectiveBackOdd - 20 / 19) < 1e-9);
    assert.equal(c.responsibilityCents, 100_000);
    assert.equal(c.stakeCents, Math.round(100_000 / 19)); // 5263
    // lucro bruto ≈ 5263; margem = 1,5% resp. + 4,5% lucro bruto
    const backOdd = 20 / 19;
    const gross = Math.round(100_000 * backOdd);
    const profit = gross - 100_000;
    const user = Math.round(100_000 * 0.015);
    assert.equal(c.marginCents, user + Math.round(profit * 0.045));
    assert.equal(c.marginCents, 1737);
  });

  it("BACK calcula margem sobre stake direto", () => {
    const c = calcBack(10_000, 2);
    assert.equal(c.input_mode, "stake");
    assert.equal(c.marginCents, calcFeeUpfront(10_000, 2).marginCents);
  });
});

describe("settle — locked_margin_v2", () => {
  const row = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    platform_deduction_cents: 6000,
    metadata: { billing_model: "locked_margin_v2", locked_margin: true },
  };

  it("detecta modelo bloqueado e margem", () => {
    assert.equal(isLockedMarginProtection(row), true);
    assert.equal(isFeeUpfrontProtection(row), false);
    assert.equal(settlementDeductionCents(row), 6000);
  });

  it("ArbiShield move 100% para Saldo Reembolso", () => {
    const p = settlementCreditParts(row, "arbishield");
    assert.deepEqual(p, { stake: 100_000, fee: 0, total: 100_000 });
  });

  it("Exchange retém a margem e devolve o restante ao Saldo Apostador", () => {
    assert.deepEqual(settlementCreditParts(row, "exchange"), {
      stake: 94_000,
      fee: 6000,
      total: 94_000,
    });
  });

  it("Empate Anula devolve 100%", () => {
    assert.equal(isVoidSettleOutcome("empate_anula"), true);
    assert.equal(normalizeSettleOutcome("Empate Anula"), "void");
    assert.deepEqual(settlementCreditParts(row, "empate_anula"), {
      stake: 100_000,
      fee: 0,
      total: 100_000,
    });
    assert.deepEqual(settlementCreditParts(row, "void"), {
      stake: 100_000,
      fee: 0,
      total: 100_000,
    });
  });

  it("status e bucket corretos", () => {
    assert.equal(settlementStatusForOutcome("arbishield"), "lost_exchange");
    assert.equal(settlementStatusForOutcome("exchange"), "won_exchange");
    assert.equal(settlementStatusForOutcome("empate_anula"), "void");
    assert.equal(settlementCreditBucket(row, "arbishield"), "deduction_balance_cents");
    assert.equal(settlementCreditBucket(row, "exchange"), "balance_cents");
    assert.equal(settlementCreditBucket(row, "void"), "balance_cents");
    assert.equal(creditBucketForSettlement("REAL"), "deduction_balance_cents");
  });
});

describe("settle — legado", () => {
  const row = {
    amount_cents: 10_000,
    platform_deduction_cents: 1500,
    metadata: {},
  };

  it("ArbiShield devolve stake inteiro", () => {
    assert.deepEqual(settlementCreditParts(row, "arbishield"), {
      stake: 10_000,
      fee: 0,
      total: 10_000,
    });
  });

  it("Exchange devolve stake − taxa", () => {
    assert.deepEqual(settlementCreditParts(row, "exchange"), {
      stake: 8500,
      fee: 0,
      total: 8500,
    });
  });

  it("Empate Anula libera stake inteiro (legado)", () => {
    assert.deepEqual(settlementCreditParts(row, "void"), {
      stake: 10_000,
      fee: 0,
      total: 10_000,
    });
  });
});
