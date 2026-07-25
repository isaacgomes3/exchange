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
} from "./lib/protection-flow-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("contrato travado — metadados", () => {
  it("mantém versão e lock", () => {
    assert.equal(PROTECTION_FLOW_CONTRACT_VERSION, "protection-flow-contract-v1");
    assert.equal(
      PROTECTION_FLOW_LOCK,
      "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST"
    );
  });

  it("AGENTS.md cita o lock do fluxo", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    assert.match(agents, /DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(agents, /protection-flow-contract-v1/);
    assert.match(agents, /Saldo Reembolso/);
  });

  it("carteira do cliente exibe Saldo Reembolso (não Saldo Dedução)", () => {
    const html = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-carteira.html"),
      "utf8"
    );
    assert.match(html, /Saldo Reembolso/);
    assert.doesNotMatch(html, /Saldo Dedução/);
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

describe("fee_upfront — cálculo", () => {
  it("LAY @ 20 resp. R$1000 → dedução conhecida", () => {
    // back equiv = 20/19 ≈ 1.052631…
    const c = calcLay(100_000, 20);
    assert.equal(c.input_mode, "responsabilidade");
    assert.equal(c.responsibilityCents, 100_000);
    assert.equal(c.stakeCents, Math.round(100_000 / 19)); // 5263
    // lucro bruto ≈ 5263; user 1.5% = 1500; dedução = lucro - 1500
    const backOdd = 20 / 19;
    const gross = Math.round(100_000 * backOdd);
    const profit = gross - 100_000;
    const user = Math.round(100_000 * 0.015);
    assert.equal(c.arbiShieldDeductionCents, Math.max(0, profit - user));
    assert.equal(c.arbiShieldDeductionCents, 3763);
  });

  it("BACK fee_upfront usa stake direto", () => {
    const c = calcBack(10_000, 2);
    assert.equal(c.input_mode, "stake");
    assert.equal(c.arbiShieldDeductionCents, calcFeeUpfront(10_000, 2).arbiShieldDeductionCents);
  });
});

describe("settle — fee_upfront", () => {
  const row = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    platform_deduction_cents: 3763,
    metadata: { billing_model: "fee_upfront_v1", fee_upfront: true },
  };

  it("detecta fee_upfront", () => {
    assert.equal(isFeeUpfrontProtection(row), true);
    assert.equal(settlementDeductionCents(row), 3763);
  });

  it("ArbiShield devolve stake + dedução", () => {
    const p = settlementCreditParts(row, "arbishield");
    assert.deepEqual(p, { stake: 100_000, fee: 3763, total: 103_763 });
  });

  it("Exchange não devolve nada", () => {
    assert.deepEqual(settlementCreditParts(row, "exchange"), {
      stake: 0,
      fee: 0,
      total: 0,
    });
  });

  it("status e bucket corretos", () => {
    assert.equal(settlementStatusForOutcome("arbishield"), "lost_exchange");
    assert.equal(settlementStatusForOutcome("exchange"), "won_exchange");
    assert.equal(creditBucketForSettlement("REAL"), "deduction_balance_cents");
    assert.equal(creditBucketForSettlement("DEMO"), "deduction_balance_cents");
    assert.equal(creditBucketForSettlement("INVESTOR"), "deduction_balance_cents");
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
});
