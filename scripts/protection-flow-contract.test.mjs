/**
 * Contrato de produto ArbiShield v11.
 * Mudanças exigem solicitação explícita, bump de versão, docs e callers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ARBISHIELD_REQUIRES_PROOF_RULE,
  CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
  ENTRY_BEFORE_KICKOFF_ONLY,
  EXCHANGE_INCOMPLETE_HEAL_RULE,
  FEE_FORMULA_GROSS_MINUS_USER,
  FEE_UPFRONT_ACTIVE_RULE,
  MAX_STAKE_FRACTION_OF_APOSTADOR,
  ONE_OPERATION_PER_EVENT,
  PROTECTION_FLOW_CONTRACT_VERSION,
  PROTECTION_FLOW_LOCK,
  PROTECTION_FLOW_SPEC,
  SETTLEMENT_ODD_CANONICAL_RULE,
  arbishieldRequiresProof,
  calcBack,
  calcFeeUpfront,
  calcLay,
  cancelRefundCents,
  computeArbiShieldDeductionCents,
  creditBucketForSettlement,
  exchangeCommissionCentsFromProfit,
  exchangeWalletHealNeeded,
  grossProfitCentsForFees,
  isCancelledProtectionStatus,
  isExchangeWalletComplete,
  isFeeUpfrontProtection,
  isMatchKickoffPassed,
  isStakeLockProtection,
  isVoidSettleOutcome,
  maxStakeLockCents,
  normalizeSettleOutcome,
  settlementCreditParts,
  settlementDeductionCents,
  settlementExchangeCommissionCents,
  settlementExchangeCommissionWalletCents,
  settlementMarketOdd,
  settlementMarketType,
  settlementStatusForOutcome,
} from "./lib/protection-flow-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const source = (relativePath) =>
  readFileSync(resolve(root, relativePath), "utf8");

const feeUpfront10 = {
  amount_cents: 100_000,
  responsibility_cents: 100_000,
  odd: 10,
  platform_deduction_cents: 9_611,
  metadata: {
    billing_model: "fee_upfront_v1",
    fee_upfront: true,
    fee_charged_cents: 9_611,
    market_type: "LAY",
    market_odd: 10,
  },
};

const historicalStakeLock10 = {
  amount_cents: 100_000,
  responsibility_cents: 100_000,
  odd: 10,
  platform_deduction_cents: 9_611,
  metadata: {
    billing_model: "stake_lock_v1",
    stake_lock: true,
    market_type: "LAY",
    market_odd: 10,
  },
};

describe("contrato v11 — modelo ativo", () => {
  it("publica versão, lock e markers explícitos", () => {
    assert.equal(
      PROTECTION_FLOW_CONTRACT_VERSION,
      "protection-flow-contract-v11"
    );
    assert.equal(
      PROTECTION_FLOW_LOCK,
      "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.equal(FEE_UPFRONT_ACTIVE_RULE, "fee-upfront-ativo-v11");
    assert.equal(
      ARBISHIELD_REQUIRES_PROOF_RULE,
      "arbishield-exige-comprovante-v11"
    );
    assert.equal(FEE_FORMULA_GROSS_MINUS_USER, "fee-lucro-menos-1_5-v11");
    assert.equal(
      CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
      "cancel-fee-upfront-nao-devolve-stake-v6"
    );
  });

  it("SPEC descreve fee_upfront sem trava", () => {
    assert.equal(PROTECTION_FLOW_SPEC.version, PROTECTION_FLOW_CONTRACT_VERSION);
    assert.equal(PROTECTION_FLOW_SPEC.model, "fee_upfront_v1");
    assert.equal(PROTECTION_FLOW_SPEC.requiresExplicitRequestToChange, true);
    assert.equal(PROTECTION_FLOW_SPEC.activation.locksStake, false);
    assert.equal(
      PROTECTION_FLOW_SPEC.activation.chargesDeductionOnCreate,
      true
    );
    assert.equal(
      PROTECTION_FLOW_SPEC.activation.maxFractionOfRemainingApostador,
      0.5
    );
    assert.equal(PROTECTION_FLOW_SPEC.activation.oneOperationPerEvent, true);
    assert.equal(PROTECTION_FLOW_SPEC.activation.entryOnlyBeforeKickoff, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.arbishield.requiresProof, true);
    assert.equal(
      PROTECTION_FLOW_SPEC.outcomes.arbishield.creditStakeToReembolso,
      false
    );
    assert.equal(
      PROTECTION_FLOW_SPEC.outcomes.exchange.chargeDeductionOnly,
      false
    );
    assert.equal(
      PROTECTION_FLOW_SPEC.outcomes.exchange.unlockReturnToOrigin,
      false
    );
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.creditTotal, 0);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.void.refundFeeOnly, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.cancel.refundFeeOnly, true);
  });
});

describe("ativação — limites preservados", () => {
  it("mantém 50%, uma operação e entrada antes do kickoff", () => {
    assert.equal(MAX_STAKE_FRACTION_OF_APOSTADOR, 0.5);
    assert.equal(ONE_OPERATION_PER_EVENT, true);
    assert.equal(ENTRY_BEFORE_KICKOFF_ONLY, true);
    assert.equal(maxStakeLockCents(100_000), 50_000);
    assert.equal(maxStakeLockCents(95_000), 47_500);

    const kickoff = new Date("2026-07-27T18:00:00.000Z").getTime();
    assert.equal(isMatchKickoffPassed(kickoff, kickoff - 1), false);
    assert.equal(isMatchKickoffPassed(kickoff, kickoff), true);
  });

  it("proteção cancelada libera nova tentativa; ativa não", () => {
    assert.equal(isCancelledProtectionStatus("cancelled"), true);
    assert.equal(isCancelledProtectionStatus("refunded"), true);
    assert.equal(isCancelledProtectionStatus("active"), false);
  });
});

describe("taxa v11 — lucro bruto menos somente 1,5% do usuário", () => {
  it("LAY R$1000 @10 cobra R$96,11", () => {
    const c = calcLay(100_000, 10);
    assert.equal(c.billing_model, "fee_upfront_v1");
    assert.equal(c.input_mode, "responsabilidade");
    assert.equal(c.grossProfitCents, 11_111);
    assert.equal(c.userProfitCents, 1_500);
    assert.equal(c.exchangeCommissionCents, 500);
    assert.equal(c.arbiShieldDeductionCents, 9_611);
  });

  it("LAY R$1000 @32 cobra R$17,26", () => {
    const c = calcLay(100_000, 32);
    assert.equal(c.grossProfitCents, 3_226);
    assert.equal(c.userProfitCents, 1_500);
    assert.equal(c.exchangeCommissionCents, 145);
    assert.equal(c.arbiShieldDeductionCents, 1_726);
  });

  it("BACK e helper genérico também não subtraem Exchange", () => {
    const c = calcBack(10_000, 2);
    assert.equal(c.billing_model, "fee_upfront_v1");
    assert.equal(c.grossProfitCents, 10_000);
    assert.equal(c.userProfitCents, 150);
    assert.equal(c.exchangeCommissionCents, 450);
    assert.equal(c.arbiShieldDeductionCents, 9_850);
    assert.deepEqual(c, { ...calcFeeUpfront(10_000, 2), input_mode: "stake" });
  });

  it("compute usa v11 para fee_upfront e linha sem marker", () => {
    assert.equal(computeArbiShieldDeductionCents(feeUpfront10), 9_611);
    assert.equal(
      computeArbiShieldDeductionCents({
        amount_cents: 100_000,
        odd: 10,
        metadata: { market_type: "LAY", market_odd: 10 },
      }),
      9_611
    );
  });

  it("comissão 4,5% continua disponível apenas como informação", () => {
    assert.equal(grossProfitCentsForFees(100_000, 10, "LAY"), 11_111);
    assert.equal(exchangeCommissionCentsFromProfit(11_111), 500);
    assert.equal(settlementExchangeCommissionCents(feeUpfront10), 500);
    assert.equal(settlementExchangeCommissionWalletCents(feeUpfront10), 0);
  });
});

describe("settle fee_upfront ativo", () => {
  it("é o default vigente e exige comprovante", () => {
    assert.equal(isFeeUpfrontProtection(feeUpfront10), true);
    assert.equal(isStakeLockProtection(feeUpfront10), false);
    assert.equal(arbishieldRequiresProof(feeUpfront10), true);
    assert.equal(isFeeUpfrontProtection({ metadata: {} }), true);
    assert.equal(arbishieldRequiresProof({ metadata: {} }), true);
  });

  it("ArbiShield fica pending_refund e valor elegível não é crédito imediato", () => {
    assert.equal(
      settlementStatusForOutcome("arbishield", feeUpfront10),
      "pending_refund"
    );
    assert.deepEqual(settlementCreditParts(feeUpfront10, "arbishield"), {
      stake: 100_000,
      fee: 9_611,
      total: 109_611,
    });
  });

  it("Exchange credita zero, sem stake return", () => {
    assert.equal(
      settlementStatusForOutcome("exchange", feeUpfront10),
      "won_exchange"
    );
    assert.deepEqual(settlementCreditParts(feeUpfront10, "exchange"), {
      stake: 0,
      fee: 0,
      total: 0,
    });
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: true,
        feeExpected: 9_611,
        feeCharged: 0,
        needsUnlock: false,
        needsReturn: false,
      }),
      true
    );
  });

  it("void e cancel devolvem somente a taxa", () => {
    assert.equal(isVoidSettleOutcome("empate anula"), true);
    assert.equal(normalizeSettleOutcome("empate-anula"), "void");
    assert.equal(settlementStatusForOutcome("void", feeUpfront10), "void");
    assert.deepEqual(settlementCreditParts(feeUpfront10, "void"), {
      stake: 0,
      fee: 9_611,
      total: 9_611,
    });
    assert.equal(
      creditBucketForSettlement("REAL", feeUpfront10, "void"),
      "deduction_balance_cents"
    );
    assert.equal(cancelRefundCents(feeUpfront10), 9_611);
  });
});

describe("compatibilidade histórica stake_lock_v1", () => {
  it("mantém fórmula 9111 e não exige comprovante", () => {
    assert.equal(isStakeLockProtection(historicalStakeLock10), true);
    assert.equal(isFeeUpfrontProtection(historicalStakeLock10), false);
    assert.equal(arbishieldRequiresProof(historicalStakeLock10), false);
    assert.equal(
      computeArbiShieldDeductionCents(historicalStakeLock10),
      9_111
    );
    assert.equal(settlementDeductionCents(historicalStakeLock10), 9_111);
  });

  it("ArbiShield histórico mantém auto-crédito e lost_exchange", () => {
    assert.equal(
      settlementStatusForOutcome("arbishield", historicalStakeLock10),
      "lost_exchange"
    );
    assert.deepEqual(
      settlementCreditParts(historicalStakeLock10, "arbishield"),
      { stake: 100_000, fee: 0, total: 100_000 }
    );
    assert.equal(
      creditBucketForSettlement("REAL", historicalStakeLock10, "arbishield"),
      "deduction_balance_cents"
    );
  });

  it("void/cancel histórico devolvem stake à origem", () => {
    assert.deepEqual(settlementCreditParts(historicalStakeLock10, "void"), {
      stake: 100_000,
      fee: 0,
      total: 100_000,
    });
    assert.equal(
      creditBucketForSettlement("REAL", historicalStakeLock10, "void"),
      "balance_cents"
    );
    assert.equal(cancelRefundCents(historicalStakeLock10), 100_000);
  });

  it("preserva odd canônica e heal Exchange históricos", () => {
    assert.equal(SETTLEMENT_ODD_CANONICAL_RULE, "settlement-odd-canonico-v10");
    assert.equal(
      EXCHANGE_INCOMPLETE_HEAL_RULE,
      "settle-exchange-heal-incompleto-v10"
    );
    const row32 = {
      ...historicalStakeLock10,
      odd: 32,
      metadata: {
        ...historicalStakeLock10.metadata,
        market_odd: 10,
        contestation: { approved_odd: 32 },
      },
    };
    assert.equal(settlementMarketOdd(row32), 32);
    assert.equal(settlementMarketType(row32), "LAY");
    assert.equal(settlementDeductionCents(row32), 1_581);
    assert.equal(
      exchangeWalletHealNeeded(row32, {
        hasTx: true,
        feeCharged: 0,
        unlocked: false,
        stakeReturned: false,
      }),
      true
    );
  });
});

describe("integração dos callers e documentação", () => {
  it("create TypeScript debita fee, não locked", () => {
    const createTs = source("src/lib/arbishield/create-protection.ts");
    assert.match(createTs, /billing_model:\s*"fee_upfront_v1"/);
    assert.match(createTs, /fee_charged_cents:\s*feeCents/);
    assert.match(createTs, /type:\s*"protection_fee"/);
    assert.match(createTs, /amount_cents:\s*-feeCents/);
    assert.match(createTs, /lockedCents:\s*0/);
    assert.match(createTs, /if \(feeCents > available\)/);
    assert.match(createTs, /if \(amountCents > maxLock\)/);
    assert.doesNotMatch(
      createTs,
      /locked_balance_cents:\s*num\(profile\.locked_balance_cents\)\s*\+/
    );
  });

  it("UI de ativação calcula e comunica fee_upfront v11", () => {
    const ui = source("deploy/vps-supabase/static/v2/app-proteger.html");
    assert.match(ui, /fee_upfront_v1/);
    assert.match(ui, /feeNow = Math\.max\(0,\s*profit - userProfit\)/);
    assert.match(ui, /deducao = Math\.max\(0,\s*lucroBruto - seuLucro\)/);
    assert.match(ui, /Taxa ArbiShield cobrada agora/);
    assert.match(ui, /stake não travado/);
    assert.match(ui, /if \(feePreview > availBal\)/);
    assert.doesNotMatch(
      ui,
      /feeNow = Math\.max\(0,\s*profit - commission - userProfit\)/
    );
  });

  it("modal admin informa pending proof sem prometer auto-crédito", () => {
    const admin = source("deploy/vps-supabase/static/v2/admin-jogos.html");
    assert.match(admin, /pending_refund, sem crédito automático/);
    assert.match(admin, /fee_upfront v11/);
    assert.match(admin, /isHistoricalStakeLock/);
    assert.match(admin, /taxa já cobrada na ativação/);
  });

  it("UI de proteções não promete stake no cancel fee_upfront", () => {
    const protections = source(
      "deploy/vps-supabase/static/v2/app-protecoes.html"
    );
    assert.match(protections, /fee_upfront v11/);
    assert.match(protections, /estorna somente a taxa/);
    assert.match(protections, /Valor estornado/);
  });

  it("prelive cria fee_upfront e adia ArbiShield para comprovante", () => {
    const prelive = source("scripts/arbishield-prelive-events.mjs");
    const createStart = prelive.indexOf("async function createProtection");
    const createEnd = prelive.indexOf("const CONTESTATION_LOCK_MS", createStart);
    const create = prelive.slice(createStart, createEnd);
    assert.match(create, /type:\s*"protection_fee"/);
    assert.match(create, /fee_charged_cents:\s*feeCents/);
    assert.match(create, /lockedCents:\s*0/);
    assert.doesNotMatch(
      create,
      /locked_balance_cents:\s*n\(profile\.locked_balance_cents\)\s*\+/
    );
    assert.match(prelive, /arbishieldRequiresProof/);
    assert.match(prelive, /deferredProof:\s*true/);
    assert.match(prelive, /eligibleRefundCents:\s*Math\.max\(0,\s*parts\.total\)/);
    assert.match(
      prelive,
      /settlementStatusForOutcome\(outcomeNorm,\s*row\)/
    );
  });

  it("shim tem fallback v11, deferred proof e status por row", () => {
    const shim = source("scripts/arbishield-serverfn-shim.mjs");
    assert.match(shim, /protection-flow-contract-v11/);
    assert.match(shim, /arbishieldRequiresProof/);
    assert.match(
      shim,
      /arbiShieldDeductionCents:\s*Math\.max\(\s*0,\s*grossProfitCents - userProfitCents/s
    );
    assert.match(shim, /deferredProof:\s*true/);
    assert.match(shim, /eligibleRefundCents:\s*Math\.max\(0,\s*parts\.total\)/);
    assert.match(shim, /settlementStatusForOutcome\(outcome,\s*row\)/);
    assert.match(shim, /createProtectionModel:\s*"fee_upfront_v1"/);
  });

  it("AGENTS e doc registram as regras v11", () => {
    for (const doc of [
      source("AGENTS.md"),
      source("docs/PROTECTION_FLOW_LOCKED.md"),
    ]) {
      assert.match(doc, /protection-flow-contract-v11/);
      assert.match(doc, /fee_upfront_v1/);
      assert.match(doc, /solicitação explícita/i);
      assert.match(doc, /não (?:debita nem )?trava|não.*stake travado/i);
      assert.match(doc, /50%/);
      assert.match(doc, /antes do kickoff|após o início/i);
      assert.match(doc, /uma proteção por evento|uma operação por evento/i);
      assert.match(doc, /pending_refund/);
      assert.match(doc, /comprovante/i);
      assert.match(doc, /96,11/);
      assert.match(doc, /17,26/);
      assert.match(doc, /stake_lock_v1/);
    }
  });
});
