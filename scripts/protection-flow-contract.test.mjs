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
  PROTECTION_FLOW_SPEC,
  STAKE_LOCK_RULE,
  MAX_STAKE_FRACTION_OF_APOSTADOR,
  ONE_OPERATION_PER_EVENT,
  ENTRY_BEFORE_KICKOFF_ONLY,
  maxStakeLockCents,
  apostadorRemainingAfterLock,
  isMatchKickoffPassed,
  isCancelledProtectionStatus,
  calcFeeUpfront,
  calcLay,
  calcBack,
  settlementCreditParts,
  settlementDeductionCents,
  creditBucketForSettlement,
  settlementStatusForOutcome,
  isFeeUpfrontProtection,
  isStakeLockProtection,
  isVoidSettleOutcome,
  normalizeSettleOutcome,
  cancelRefundCents,
  CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
  EXCHANGE_CHARGE_DEDUCTION_RULE,
  isExchangeWalletComplete,
  EXCHANGE_COMMISSION_RATE,
  exchangeCommissionCentsFromProfit,
  settlementExchangeCommissionCents,
} from "./lib/protection-flow-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("contrato travado — metadados", () => {
  it("mantém versão e lock", () => {
    assert.equal(PROTECTION_FLOW_CONTRACT_VERSION, "protection-flow-contract-v6");
    assert.equal(STAKE_LOCK_RULE, "stake-lock-v1");
    assert.equal(MAX_STAKE_FRACTION_OF_APOSTADOR, 0.5);
    assert.equal(ONE_OPERATION_PER_EVENT, true);
    assert.equal(ENTRY_BEFORE_KICKOFF_ONLY, true);
    assert.equal(
      PROTECTION_FLOW_LOCK,
      "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST"
    );
  });

  it("PROTECTION_FLOW_SPEC espelha as regras vigentes (só muda com pedido explícito)", () => {
    assert.equal(PROTECTION_FLOW_SPEC.requiresExplicitRequestToChange, true);
    assert.equal(PROTECTION_FLOW_SPEC.lock, PROTECTION_FLOW_LOCK);
    assert.equal(PROTECTION_FLOW_SPEC.version, PROTECTION_FLOW_CONTRACT_VERSION);
    assert.equal(PROTECTION_FLOW_SPEC.model, "stake_lock_v1");
    assert.equal(PROTECTION_FLOW_SPEC.activation.locksStake, true);
    assert.equal(PROTECTION_FLOW_SPEC.activation.chargesDeductionOnCreate, false);
    assert.equal(PROTECTION_FLOW_SPEC.activation.maxFractionOfRemainingApostador, 0.5);
    assert.equal(PROTECTION_FLOW_SPEC.activation.successiveCapOnRemaining, true);
    assert.equal(PROTECTION_FLOW_SPEC.activation.oneOperationPerEvent, true);
    assert.equal(PROTECTION_FLOW_SPEC.activation.entryOnlyBeforeKickoff, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.arbishield.creditStakeToReembolso, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.creditReembolso, false);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.creditTotal, 0);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.chargeDeductionOnly, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.unlockWithoutReturn, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.void.unlockReturnToOrigin, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.cancel.unlockReturnToOrigin, true);
  });

  it("AGENTS.md e docs/PROTECTION_FLOW_LOCKED.md travam o fluxo", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    const lockedDoc = readFileSync(
      resolve(root, "docs/PROTECTION_FLOW_LOCKED.md"),
      "utf8"
    );
    assert.match(agents, /DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(agents, /protection-flow-contract-v6/);
    assert.match(agents, /LOCKED/);
    assert.match(agents, /solicitação explícita/);
    assert.match(agents, /docs\/PROTECTION_FLOW_LOCKED\.md/);
    assert.match(agents, /stake_lock_v1/);
    assert.match(agents, /trava o stake/);
    assert.match(agents, /50%/);
    assert.match(agents, /Uma operação por evento/);
    assert.match(agents, /Sem entrada após o início/);
    assert.match(agents, /Saldo Reembolso/);
    assert.match(agents, /Ganhou na ArbiShield/);
    assert.match(agents, /Ganhou na Exchange/);
    assert.match(agents, /Empate Anula/);
    assert.match(lockedDoc, /DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(lockedDoc, /protection-flow-contract-v6/);
    assert.match(lockedDoc, /LOCKED/);
    assert.match(lockedDoc, /solicitação explícita/);
    assert.match(lockedDoc, /Uma operação por evento|1 operação por evento|uma proteção por jogo/i);
    assert.match(lockedDoc, /antes do início|antes do kickoff/i);
  });

  it("prelive e shim importam o contrato", () => {
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
    assert.match(prelive, /maxStakeLockCents/);
    assert.match(prelive, /isMatchKickoffPassed/);
    assert.match(prelive, /isCancelledProtectionStatus/);
    assert.doesNotMatch(prelive, /function settlementCreditParts\s*\(/);
    assert.doesNotMatch(shim, /function settlementCreditParts\s*\(/);
  });

  it("create-protection e UI: 50% + 1op + antes do kickoff", () => {
    const createTs = readFileSync(
      resolve(root, "src/lib/arbishield/create-protection.ts"),
      "utf8"
    );
    const ui = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-proteger.html"),
      "utf8"
    );
    assert.match(createTs, /maxStakeLockCents/);
    assert.match(createTs, /isMatchKickoffPassed/);
    assert.match(createTs, /uma proteção por jogo/);
    assert.match(createTs, /já iniciado/);
    assert.match(ui, /maxStakeLockCents/);
    assert.match(ui, /50%/);
    assert.match(ui, /isMatchKickoffPassed/);
    assert.match(ui, /occupiedMatchIds/);
    assert.match(ui, /1 proteção por evento/);
    assert.match(ui, /btnAmountMax/);
    assert.match(ui, /applyMaxAmount/);
    assert.match(ui, /currentEventMaxCents/);
    assert.match(ui, /Máx\. efetivo neste evento/);
    assert.match(ui, /limitado pela liquidez/);
  });

  it("carteira do cliente exibe Saldo Reembolso", () => {
    const html = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-carteira.html"),
      "utf8"
    );
    assert.match(html, /Saldo Reembolso/);
    assert.doesNotMatch(html, /Saldo Dedução/);
  });
});

describe("ativação — teto 50% Apostador", () => {
  it("maxStakeLockCents = floor(50% disponível)", () => {
    assert.equal(maxStakeLockCents(100_000), 50_000);
    assert.equal(maxStakeLockCents(1), 0);
    assert.equal(maxStakeLockCents(0), 0);
    assert.equal(maxStakeLockCents(-10), 0);
    assert.equal(maxStakeLockCents(99), 49);
  });

  it("eventos sucessivos: 50% do restante após cada trava", () => {
    // Banca 1000 → evento1 máx 500; usa 500 → resta 500 → evento2 máx 250;
    // usa 250 → resta 250 → evento3 máx 125.
    let avail = 100_000;
    const caps = [];
    for (let i = 0; i < 3; i++) {
      const cap = maxStakeLockCents(avail);
      caps.push(cap);
      avail = apostadorRemainingAfterLock(avail, cap);
    }
    assert.deepEqual(caps, [50_000, 25_000, 12_500]);
    assert.equal(avail, 12_500);
  });

  it("AGENTS.md descreve o teto sucessivo sobre o restante", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    assert.match(agents, /sucessivamente/);
    assert.match(agents, /50% do que sobrou/);
  });
});

describe("ativação — 1 op/evento e antes do kickoff", () => {
  it("isMatchKickoffPassed: bloqueia no/após starts_at", () => {
    const start = "2026-07-27T18:00:00.000Z";
    const t = new Date(start).getTime();
    assert.equal(isMatchKickoffPassed(start, t - 1), false);
    assert.equal(isMatchKickoffPassed(start, t), true);
    assert.equal(isMatchKickoffPassed(start, t + 60_000), true);
    assert.equal(isMatchKickoffPassed(null, t), false);
  });

  it("cancelada/estornada não conta como operação ativa", () => {
    assert.equal(isCancelledProtectionStatus("cancelled"), true);
    assert.equal(isCancelledProtectionStatus("canceled"), true);
    assert.equal(isCancelledProtectionStatus("refunded"), true);
    assert.equal(isCancelledProtectionStatus("active"), false);
    assert.equal(isCancelledProtectionStatus("won_exchange"), false);
    assert.equal(isCancelledProtectionStatus("lost_exchange"), false);
    assert.equal(isCancelledProtectionStatus("void"), false);
  });
});

describe("cálculo dedução", () => {
  it("LAY @ 20 resp. R$1000 → dedução conhecida", () => {
    const c = calcLay(100_000, 20);
    assert.equal(c.input_mode, "responsabilidade");
    assert.equal(c.odd, 20);
    assert.equal(c.billing_model, "stake_lock_v1");
    assert.equal(c.arbiShieldDeductionCents, 3763);
  });

  it("BACK usa stake direto", () => {
    const c = calcBack(10_000, 2);
    assert.equal(c.input_mode, "stake");
    assert.equal(
      c.arbiShieldDeductionCents,
      calcFeeUpfront(10_000, 2).arbiShieldDeductionCents
    );
  });
});

describe("settle — stake_lock vigente", () => {
  const row = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    platform_deduction_cents: 3763,
    metadata: { billing_model: "stake_lock_v1", stake_lock: true },
  };

  it("detecta stake_lock (não fee_upfront)", () => {
    assert.equal(isStakeLockProtection(row), true);
    assert.equal(isFeeUpfrontProtection(row), false);
    assert.equal(settlementDeductionCents(row), 3763);
  });

  it("Ganhou na ArbiShield credita só o stake → Reembolso", () => {
    assert.equal(normalizeSettleOutcome("arbishield"), "arbishield");
    assert.deepEqual(settlementCreditParts(row, "arbishield"), {
      stake: 100_000,
      fee: 0,
      total: 100_000,
    });
    assert.equal(
      creditBucketForSettlement("REAL", row, "arbishield"),
      "deduction_balance_cents"
    );
  });

  it("Ganhou na Exchange → R$ 0 (não Reembolso)", () => {
    assert.deepEqual(settlementCreditParts(row, "exchange"), {
      stake: 0,
      fee: 0,
      total: 0,
    });
  });

  it("Empate Anula → stake (destino = origem, não Reembolso)", () => {
    assert.equal(isVoidSettleOutcome("empate_anula"), true);
    assert.deepEqual(settlementCreditParts(row, "void"), {
      stake: 100_000,
      fee: 0,
      total: 100_000,
    });
    assert.equal(
      creditBucketForSettlement("REAL", row, "void"),
      "balance_cents"
    );
    assert.equal(
      creditBucketForSettlement("DEMO", row, "void"),
      "demo_balance_cents"
    );
  });

  it("status corretos", () => {
    assert.equal(settlementStatusForOutcome("arbishield"), "lost_exchange");
    assert.equal(settlementStatusForOutcome("exchange"), "won_exchange");
    assert.equal(settlementStatusForOutcome("empate_anula"), "void");
  });
});

describe("settle — histórico fee_upfront", () => {
  const row = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    platform_deduction_cents: 3763,
    metadata: { billing_model: "fee_upfront_v1", fee_upfront: true },
  };

  it("ArbiShield devolve stake + dedução", () => {
    assert.equal(isFeeUpfrontProtection(row), true);
    assert.deepEqual(settlementCreditParts(row, "arbishield"), {
      stake: 100_000,
      fee: 3763,
      total: 103_763,
    });
  });

  it("Exchange → 0", () => {
    assert.deepEqual(settlementCreditParts(row, "exchange"), {
      stake: 0,
      fee: 0,
      total: 0,
    });
  });

  it("Empate Anula devolve só a dedução (histórico)", () => {
    assert.deepEqual(settlementCreditParts(row, "void"), {
      stake: 0,
      fee: 3763,
      total: 3763,
    });
    assert.equal(
      creditBucketForSettlement("REAL", row, "void"),
      "deduction_balance_cents"
    );
  });
});

describe("anti-regressão — Exchange nunca Reembolso", () => {
  it("exchange.total === 0 em stake_lock e fee_upfront", () => {
    const lock = {
      amount_cents: 50_000,
      platform_deduction_cents: 1000,
      metadata: { billing_model: "stake_lock_v1" },
    };
    const feeUp = {
      amount_cents: 50_000,
      platform_deduction_cents: 1000,
      metadata: { billing_model: "fee_upfront_v1", fee_upfront: true },
    };
    assert.equal(settlementCreditParts(lock, "exchange").total, 0);
    assert.equal(settlementCreditParts(feeUp, "exchange").total, 0);
  });
});

describe("cancel — fee_upfront nunca devolve stake", () => {
  it("guarda cancel-fee-upfront-nao-devolve-stake-v6", () => {
    assert.equal(
      CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
      "cancel-fee-upfront-nao-devolve-stake-v6"
    );
  });

  it("fee_upfront explícito → só dedução (caso Carlos LAY 1000 @10)", () => {
    const fee = calcLay(100_000, 10).arbiShieldDeductionCents;
    assert.equal(fee, 9611);
    const row = {
      amount_cents: 100_000,
      responsibility_cents: 100_000,
      platform_deduction_cents: fee,
      odd: 10,
      metadata: {
        billing_model: "fee_upfront_v1",
        fee_upfront: true,
        market_type: "LAY",
        fee_charged_cents: fee,
      },
    };
    assert.equal(isFeeUpfrontProtection(row), true);
    assert.equal(isStakeLockProtection(row), false);
    assert.equal(cancelRefundCents(row), fee);
  });

  it("só fee_charged_cents (sem billing_model) → ainda fee, não stake", () => {
    const row = {
      amount_cents: 100_000,
      responsibility_cents: 100_000,
      platform_deduction_cents: 9611,
      metadata: { fee_charged_cents: 9611, market_type: "LAY", market_odd: 10 },
    };
    assert.equal(isFeeUpfrontProtection(row), true);
    assert.equal(cancelRefundCents(row), 9611);
  });

  it("stake_lock → devolve stake", () => {
    const row = {
      amount_cents: 100_000,
      responsibility_cents: 100_000,
      platform_deduction_cents: 9611,
      metadata: { billing_model: "stake_lock_v1", stake_lock: true },
    };
    assert.equal(cancelRefundCents(row), 100_000);
  });
});

describe("Comissão Exchange 4,5% do lucro", () => {
  it("taxa 4,5% e não altera dedução (lucro − 1,5%)", () => {
    assert.equal(EXCHANGE_COMMISSION_RATE, 0.045);
    const c = calcLay(100_000, 10);
    // lucro bruto LAY 1000 @10 → backOdd 1.111… → profit 11111
    assert.equal(c.grossProfitCents, 11111);
    assert.equal(c.userProfitCents, 1500);
    assert.equal(c.arbiShieldDeductionCents, 9611); // inalterado
    assert.equal(c.exchangeCommissionCents, Math.round(11111 * 0.045)); // 500
    assert.equal(c.exchangeFeeCents, c.exchangeCommissionCents);
    assert.equal(
      exchangeCommissionCentsFromProfit(11111),
      c.exchangeCommissionCents
    );
  });

  it("settlementExchangeCommissionCents lê exchange_fee_cents / meta", () => {
    assert.equal(
      settlementExchangeCommissionCents({
        exchange_fee_cents: 500,
        platform_deduction_cents: 9611,
        metadata: { billing_model: "stake_lock_v1" },
      }),
      500
    );
    assert.equal(
      settlementExchangeCommissionCents({
        amount_cents: 100_000,
        responsibility_cents: 100_000,
        odd: 10,
        metadata: { market_type: "LAY", market_odd: 10, gross_profit_cents: 11111 },
      }),
      500
    );
  });

  it("UI bilhete e extrato citam comissão 4,5%", () => {
    const ui = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-proteger.html"),
      "utf8"
    );
    const prot = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-protecoes.html"),
      "utf8"
    );
    const pages = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/v2-pages.js"),
      "utf8"
    );
    assert.match(ui, /Comissão Exchange \(4,5% do lucro\)/);
    assert.match(prot, /Comissão Exchange \(4,5% do lucro\)/);
    assert.match(pages, /exchange_commission/);
  });
});

describe("Exchange/PERDEU — cobra dedução · R$ 0 Reembolso · destrava", () => {
  it("guarda settle-exchange-cobra-deducao-v6", () => {
    assert.equal(
      EXCHANGE_CHARGE_DEDUCTION_RULE,
      "settle-exchange-cobra-deducao-v6"
    );
  });

  it("crédito Exchange sempre 0 (stake_lock e fee_upfront)", () => {
    const lock = {
      amount_cents: 100_000,
      platform_deduction_cents: 9611,
      metadata: { billing_model: "stake_lock_v1", stake_lock: true },
    };
    const feeUp = {
      amount_cents: 100_000,
      platform_deduction_cents: 9611,
      metadata: { billing_model: "fee_upfront_v1", fee_upfront: true },
    };
    assert.equal(settlementCreditParts(lock, "exchange").total, 0);
    assert.equal(settlementCreditParts(feeUp, "exchange").total, 0);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.chargeDeductionOnly, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.unlockWithoutReturn, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.creditReembolso, false);
  });

  it("isExchangeWalletComplete exige fee cobrada no stake_lock", () => {
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: false,
        feeExpected: 9611,
        feeCharged: 0,
        unlocked: true,
        needsUnlock: true,
      }),
      false
    );
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: false,
        feeExpected: 9611,
        feeCharged: 9611,
        unlocked: true,
        needsUnlock: true,
      }),
      true
    );
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: false,
        feeExpected: 9611,
        feeCharged: 5000,
        feeShortfall: 4611,
        unlocked: true,
        needsUnlock: true,
      }),
      true
    );
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: true,
        feeExpected: 9611,
        feeCharged: 0,
        unlocked: false,
        needsUnlock: false,
      }),
      true
    );
  });

  it("prelive/shim cobram dedução no Exchange (não engolem PATCH)", () => {
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    assert.match(prelive, /settle-exchange-cobra-deducao-v6/);
    assert.match(shim, /settle-exchange-cobra-deducao-v6/);
    assert.match(prelive, /isExchangeWalletComplete/);
    assert.match(shim, /isExchangeWalletComplete/);
    assert.match(prelive, /loadExchangeSettlementPrior/);
    assert.match(shim, /loadExchangeSettlementPrior/);
    assert.match(
      prelive,
      /não encontrado para settle Exchange \(cobrar dedução\)/
    );
    assert.match(
      shim,
      /não encontrado para settle Exchange \(cobrar dedução\)/
    );
    // não pode engolir erro do PATCH Exchange com catch vazio antes do tx
    assert.match(prelive, /Exchange incompleto/);
    assert.match(shim, /Exchange incompleto/);
  });
});
