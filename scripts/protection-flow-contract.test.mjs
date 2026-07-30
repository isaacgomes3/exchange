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
  PROTECTION_BILLING_MODEL_CANONICAL,
  PROTECTION_OBSOLETE_MODELS,
  PROTECTION_RUNTIME_HEALTH_MARKER,
  CREATE_PROTECTION_FIX_MARKER,
  isProtectionRuntimeHealthy,
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
  EXCHANGE_INCOMPLETE_HEAL_RULE,
  SETTLEMENT_ODD_CANONICAL_RULE,
  isExchangeWalletComplete,
  exchangeWalletHealNeeded,
  settlementMarketOdd,
  settlementMarketType,
  settlementOutcomeFromProtectionRow,
  EXCHANGE_COMMISSION_RATE,
  exchangeCommissionCentsFromProfit,
  settlementExchangeCommissionCents,
  settlementExchangeCommissionWalletCents,
  exchangeWalletChargeCents,
  LAY_PROFIT_OVER_ODD_RULE,
  EXCHANGE_NO_DOUBLE_COMMISSION_RULE,
  grossProfitCentsForFees,
} from "./lib/protection-flow-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("contrato travado — metadados", () => {
  it("mantém versão e lock", () => {
    assert.equal(PROTECTION_FLOW_CONTRACT_VERSION, "protection-flow-contract-v10");
    assert.equal(PROTECTION_BILLING_MODEL_CANONICAL, "stake_lock_v1");
    assert.equal(
      PROTECTION_RUNTIME_HEALTH_MARKER,
      "protection-runtime-stake-lock-v10"
    );
    assert.equal(
      CREATE_PROTECTION_FIX_MARKER,
      "create-protection-stake-lock-v6"
    );
    assert.deepEqual([...PROTECTION_OBSOLETE_MODELS], [
      "fee_upfront_v1",
      "lock_fee_after_v1",
      "locked_margin_v2",
      "FLUXO_PROTECAO_V1",
      "fluxo-protecao-v1",
    ]);
    assert.equal(STAKE_LOCK_RULE, "stake-lock-v1");
    assert.equal(MAX_STAKE_FRACTION_OF_APOSTADOR, 0.5);
    assert.equal(ONE_OPERATION_PER_EVENT, true);
    assert.equal(ENTRY_BEFORE_KICKOFF_ONLY, true);
    assert.equal(
      PROTECTION_FLOW_LOCK,
      "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST"
    );
    assert.equal(
      EXCHANGE_INCOMPLETE_HEAL_RULE,
      "settle-exchange-heal-incompleto-v10"
    );
    assert.equal(SETTLEMENT_ODD_CANONICAL_RULE, "settlement-odd-canonico-v10");
  });

  it("PROTECTION_FLOW_SPEC espelha as regras vigentes (só muda com pedido explícito)", () => {
    assert.equal(PROTECTION_FLOW_SPEC.requiresExplicitRequestToChange, true);
    assert.equal(PROTECTION_FLOW_SPEC.soleSourceOfTruth, true);
    assert.equal(PROTECTION_FLOW_SPEC.lock, PROTECTION_FLOW_LOCK);
    assert.equal(PROTECTION_FLOW_SPEC.version, PROTECTION_FLOW_CONTRACT_VERSION);
    assert.equal(PROTECTION_FLOW_SPEC.model, "stake_lock_v1");
    assert.equal(PROTECTION_FLOW_SPEC.model, PROTECTION_BILLING_MODEL_CANONICAL);
    assert.equal(
      PROTECTION_FLOW_SPEC.runtimeHealthMarker,
      PROTECTION_RUNTIME_HEALTH_MARKER
    );
    assert.equal(
      PROTECTION_FLOW_SPEC.createProtectionFixMarker,
      CREATE_PROTECTION_FIX_MARKER
    );
    assert.deepEqual(
      [...PROTECTION_FLOW_SPEC.obsoleteModels],
      [...PROTECTION_OBSOLETE_MODELS]
    );
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
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.unlockWithoutReturn, false);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.unlockReturnToOrigin, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.chargeExchangeCommission, false);
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
    assert.match(agents, /protection-flow-contract-v10/);
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
    assert.match(agents, /destrava e devolve/);
    assert.match(agents, /Empate Anula/);
    assert.match(agents, /8\.976,?41|91,?11|settle-exchange-cobra-so-deducao-v9/);
    assert.match(agents, /settle-exchange-heal-incompleto-v10|9\.051,?71|15,?81/);
    assert.match(agents, /ÚNICA fonte de verdade|unica fonte de verdade/i);
    assert.match(agents, /obsoleto|pode ser excluíd/i);
    assert.match(agents, /fee_upfront_v1/);
    assert.match(agents, /locked_margin_v2|lock_fee_after_v1|FLUXO_PROTECAO_V1/);
    assert.match(agents, /Anti-regressão runtime|protection-runtime-stake-lock-v10/);
    assert.match(agents, /ALLOW_FEE_UPFRONT_DEPLOY|vps-check-pos-deploy-v10/);
    assert.match(lockedDoc, /ÚNICA fonte de verdade|unica fonte de verdade/i);
    assert.match(lockedDoc, /obsoleto|pode ser excluíd/i);
    assert.match(lockedDoc, /fee_upfront_v1/);
    assert.match(lockedDoc, /locked_margin_v2/);
    assert.match(lockedDoc, /DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(lockedDoc, /protection-flow-contract-v10/);
    assert.match(lockedDoc, /LOCKED/);
    assert.match(lockedDoc, /solicitação explícita/);
    assert.match(lockedDoc, /Uma operação por evento|1 operação por evento|uma proteção por jogo/i);
    assert.match(lockedDoc, /antes do início|antes do kickoff/i);
    assert.match(lockedDoc, /settle-exchange-cobra-so-deducao-v9/);
    assert.match(lockedDoc, /settle-exchange-heal-incompleto-v10|settlement-odd-canonico-v10/);
    assert.match(lockedDoc, /Destrava e DEVOLVE|destrava e DEVOLVE|destrava e devolve/i);
    assert.match(lockedDoc, /8\.976,?41|91,?11/);
    assert.match(lockedDoc, /9\.051,?71|15,?81/);
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

  it("health fail-hard: marker runtime + stake_lock; rejeita fee_upfront", () => {
    assert.equal(
      isProtectionRuntimeHealthy({
        createProtectionModel: "stake_lock_v1",
        protectionRuntime: PROTECTION_RUNTIME_HEALTH_MARKER,
        protectionFlowContract: PROTECTION_FLOW_CONTRACT_VERSION,
        fix: CREATE_PROTECTION_FIX_MARKER,
      }),
      true
    );
    assert.equal(
      isProtectionRuntimeHealthy({
        createProtectionModel: "fee_upfront_v1",
        fix: "protection-fee-upfront-v11",
      }),
      false
    );
    assert.equal(
      isProtectionRuntimeHealthy({
        createProtectionModel: "stake_lock_v1",
        protectionRuntime: "protection-fee-upfront-v11",
      }),
      false
    );

    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    assert.match(prelive, /PROTECTION_RUNTIME_HEALTH_MARKER/);
    assert.match(prelive, /isProtectionRuntimeHealthy/);
    assert.match(prelive, /runtimeOk \? 200 : 503/);
    assert.match(shim, /PROTECTION_RUNTIME_HEALTH_MARKER/);
    assert.match(shim, /isProtectionRuntimeHealthy/);
    assert.match(shim, /runtimeOk \? 200 : 503/);
  });

  it("anti-regressão ops: fee_upfront prod bloqueado; check pós-deploy; restaurar logo sob v10", () => {
    const feeUp = readFileSync(
      resolve(root, "scripts/vps-atualizar-protecao-fee-upfront-prod.sh"),
      "utf8"
    );
    const checkSh = readFileSync(
      resolve(root, "scripts/vps-check-pos-deploy-v10.sh"),
      "utf8"
    );
    const checkJs = readFileSync(
      resolve(root, "scripts/vps-check-pos-deploy-v10.mjs"),
      "utf8"
    );
    const logo = readFileSync(
      resolve(root, "scripts/vps-restaurar-api-logo-times.sh"),
      "utf8"
    );
    const hotfix = readFileSync(
      resolve(root, "scripts/vps-hotfix-create-stake-lock-v6.sh"),
      "utf8"
    );
    assert.match(feeUp, /ALLOW_FEE_UPFRONT_DEPLOY/);
    assert.match(feeUp, /BLOQUEADO/);
    assert.match(feeUp, /stake_lock_v1/);
    assert.match(checkSh, /vps-check-pos-deploy-v10/);
    assert.match(checkSh, /protection-runtime-stake-lock-v10/);
    assert.match(checkJs, /vps-check-pos-deploy-v10/);
    assert.match(checkJs, /isProtectionRuntimeHealthy/);
    assert.match(checkJs, /fee_upfront_v1/);
    assert.match(logo, /protecao-v10-fonte-verdade-501d/);
    assert.match(logo, /stake_lock_v1/);
    assert.doesNotMatch(logo, /perdeu fee_upfront/);
    assert.match(hotfix, /protecao-v10-fonte-verdade-501d/);
    assert.match(hotfix, /protection-flow-contract-v10/);
    assert.match(hotfix, /protection-runtime-stake-lock-v10/);
    assert.match(hotfix, /vps-check-pos-deploy-v10/);
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
  it("LAY @ 20 resp. R$1000 → lucro = resp/(odd−1) − 4,5% − 1,5%", () => {
    const c = calcLay(100_000, 20);
    assert.equal(c.input_mode, "responsabilidade");
    assert.equal(c.odd, 20);
    assert.equal(c.billing_model, "stake_lock_v1");
    // lucro 5263 − comissão 237 − usuário 1500 = 3526
    assert.equal(c.arbiShieldDeductionCents, 3526);
    assert.equal(c.exchangeCommissionCents, 237);
  });

  it("BACK usa stake direto", () => {
    const c = calcBack(10_000, 2);
    assert.equal(c.input_mode, "stake");
    assert.equal(
      c.arbiShieldDeductionCents,
      calcFeeUpfront(10_000, 2).arbiShieldDeductionCents
    );
    // lucro 10000 − 450 − 150 = 9400
    assert.equal(c.arbiShieldDeductionCents, 9400);
  });
});

describe("settle — stake_lock vigente", () => {
  const row = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    platform_deduction_cents: 3526,
    metadata: { billing_model: "stake_lock_v1", stake_lock: true },
  };

  it("detecta stake_lock (não fee_upfront)", () => {
    assert.equal(isStakeLockProtection(row), true);
    assert.equal(isFeeUpfrontProtection(row), false);
    // sem odd → cai no stored
    assert.equal(settlementDeductionCents(row), 3526);
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
    // Histórico: stored 9611 (fórmula antiga lucro−1,5%). Cancel devolve o stored.
    const feeStored = 9611;
    const row = {
      amount_cents: 100_000,
      responsibility_cents: 100_000,
      platform_deduction_cents: feeStored,
      odd: 10,
      metadata: {
        billing_model: "fee_upfront_v1",
        fee_upfront: true,
        market_type: "LAY",
        fee_charged_cents: feeStored,
      },
    };
    assert.equal(isFeeUpfrontProtection(row), true);
    assert.equal(isStakeLockProtection(row), false);
    assert.equal(cancelRefundCents(row), feeStored);
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

  it("guarda cancel-stake-lock-devolve-stake-v6 no prelive/shim/UI", () => {
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    const ui = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-protecoes.html"),
      "utf8"
    );
    assert.match(prelive, /cancel-stake-lock-devolve-stake-v6/);
    assert.match(shim, /async function claimProtectionCancelled/);
    assert.match(shim, /cancel-stake-lock-devolve-stake-v6/);
    assert.match(ui, /Stake devolvido/);
    assert.match(ui, /cancel-sem-estorno|NÃO foi devolvido/);
  });
});

describe("Comissão Exchange 4,5% do lucro", () => {
  it("LAY 1000 @10 → lucro 111,11 · cliente 15 · Exchange 5 · ArbiShield 91,11", () => {
    assert.equal(EXCHANGE_COMMISSION_RATE, 0.045);
    assert.equal(LAY_PROFIT_OVER_ODD_RULE, "lay-lucro-back-equiv-v9");
    assert.equal(grossProfitCentsForFees(100_000, 10, "LAY"), 11_111);
    const c = calcLay(100_000, 10);
    assert.equal(c.grossProfitCents, 11_111);
    assert.equal(c.userProfitCents, 1500);
    assert.equal(c.exchangeCommissionCents, Math.round(11111 * 0.045)); // 500
    assert.equal(c.exchangeFeeCents, c.exchangeCommissionCents);
    // 11111 − 500 − 1500 = 9111
    assert.equal(c.arbiShieldDeductionCents, 9111);
    // Carteira: 8067,52 + 1000 − 91,11 = 8976,41
    assert.equal(806_752 + 100_000 - c.arbiShieldDeductionCents, 897_641);
    // Comissão NÃO debita de novo
    assert.equal(settlementExchangeCommissionWalletCents(c), 0);
    assert.equal(
      EXCHANGE_NO_DOUBLE_COMMISSION_RULE,
      "settle-exchange-sem-comissao-extra-v9"
    );
  });

  it("carteira PERDEU nunca soma comissão Em cima da dedução (anti 8.982,52)", () => {
    const row = {
      amount_cents: 100_000,
      responsibility_cents: 100_000,
      odd: 10,
      metadata: {
        billing_model: "stake_lock_v1",
        stake_lock: true,
        market_type: "LAY",
        market_odd: 10,
      },
    };
    const fee = settlementDeductionCents(row);
    const info = settlementExchangeCommissionCents(row);
    const wallet = settlementExchangeCommissionWalletCents(row);
    assert.equal(fee, 9111);
    assert.equal(info, 500); // informativa
    assert.equal(wallet, 0); // NÃO sai da carteira
    assert.equal(exchangeWalletChargeCents(row), 9111);
    // Erro antigo: fee+info = 9611 → 8.971,41 ou fee+450=8.982,52
    assert.notEqual(fee + info, exchangeWalletChargeCents(row));
    assert.equal(806_752 + 100_000 - exchangeWalletChargeCents(row), 897_641);
  });

  it("stake_lock com stored antigo 8050/9611 recalcula 9111 no settle", () => {
    const row = {
      amount_cents: 100_000,
      responsibility_cents: 100_000,
      platform_deduction_cents: 8050,
      odd: 10,
      metadata: {
        billing_model: "stake_lock_v1",
        stake_lock: true,
        market_type: "LAY",
        market_odd: 10,
      },
    };
    assert.equal(settlementDeductionCents(row), 9111);
    assert.equal(settlementExchangeCommissionCents(row), 500);
    assert.equal(settlementExchangeCommissionWalletCents(row), 0);
  });

  it("settlementExchangeCommissionCents lê exchange_fee_cents / meta", () => {
    assert.equal(
      settlementExchangeCommissionCents({
        exchange_fee_cents: 500,
        platform_deduction_cents: 9111,
        metadata: { billing_model: "stake_lock_v1" },
      }),
      500
    );
    assert.equal(
      settlementExchangeCommissionCents({
        amount_cents: 100_000,
        responsibility_cents: 100_000,
        odd: 10,
        metadata: { market_type: "LAY", market_odd: 10 },
      }),
      500
    );
  });

  it("UI bilhete e extrato citam comissão 4,5% do lucro bruto", () => {
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
    const preview = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/proteger-preview-fix.js"),
      "utf8"
    );
    assert.match(ui, /Comissão Exchange \(4,5% do lucro bruto\)/);
    assert.match(prot, /Comissão Exchange \(4,5% do lucro bruto\)/);
    assert.match(preview, /Comissão Exchange \(4,5% do lucro bruto\)/);
    assert.match(ui, /Lucro bruto \(base da taxa\)/);
    assert.match(ui, /Sua fatia \(1,5% da cobertura\)/);
    assert.match(pages, /exchange_commission/);
    assert.doesNotMatch(ui, /Stake equivalente \(casa\)/);
    assert.doesNotMatch(ui, /Odd LAY → back equiv\./);
    assert.doesNotMatch(preview, /<span>Odd LAY → back equiv\.<\/span>/);
    assert.doesNotMatch(preview, /Stake equivalente \(casa\)/);
  });

  it("LAY @1,10 resp. R$500 → comissão R$225 (4,5% de R$5.000, não da fatia 1,5%)", () => {
    const c = calcLay(50_000, 1.1);
    assert.equal(c.grossProfitCents, 500_000); // resp/(odd−1) = 5000
    assert.equal(c.exchangeCommissionCents, 22_500); // 4,5% de 5000
    assert.equal(c.userProfitCents, 750); // 1,5% da cobertura (500)
    assert.equal(c.arbiShieldDeductionCents, 476_750); // 5000 − 225 − 7,50
  });
});

describe("Exchange/PERDEU — devolve stake · cobra SÓ dedução · R$ 0 Reembolso", () => {
  it("guarda settle-exchange-cobra-so-deducao-v9", () => {
    assert.equal(
      EXCHANGE_CHARGE_DEDUCTION_RULE,
      "settle-exchange-cobra-so-deducao-v9"
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
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.unlockReturnToOrigin, true);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.unlockWithoutReturn, false);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.creditReembolso, false);
    assert.equal(PROTECTION_FLOW_SPEC.outcomes.exchange.chargeExchangeCommission, false);
  });

  it("isExchangeWalletComplete exige fee + devolução no stake_lock", () => {
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: false,
        feeExpected: 9111,
        feeCharged: 0,
        unlocked: true,
        needsUnlock: true,
        stakeReturned: true,
        needsReturn: true,
      }),
      false
    );
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: false,
        feeExpected: 9111,
        feeCharged: 9111,
        unlocked: true,
        needsUnlock: true,
        stakeReturned: false,
        needsReturn: true,
      }),
      false
    );
    assert.equal(
      isExchangeWalletComplete({
        feeUpfront: false,
        feeExpected: 9111,
        feeCharged: 9111,
        unlocked: true,
        needsUnlock: true,
        stakeReturned: true,
        needsReturn: true,
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

  it("prelive/shim NÃO reintroduzem débito de comissão na carteira", () => {
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    const admin = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/admin-jogos.html"),
      "utf8"
    );
    assert.match(prelive, /settle-exchange-cobra-so-deducao-v9/);
    assert.match(shim, /settle-exchange-cobra-so-deducao-v9/);
    assert.match(prelive, /settle-exchange-sem-comissao-extra-v9/);
    assert.match(shim, /settle-exchange-sem-comissao-extra-v9/);
    assert.match(prelive, /settlementExchangeCommissionWalletCents/);
    assert.match(shim, /settlementExchangeCommissionWalletCents/);
    assert.match(prelive, /BLOQUEADO débito de comissão Exchange/);
    assert.match(shim, /BLOQUEADO débito de comissão Exchange/);
    assert.match(prelive, /needsReturn/);
    assert.match(shim, /needsReturn/);
    assert.match(prelive, /stake_returned/);
    assert.match(shim, /stake_returned/);
    assert.match(prelive, /cobra só dedução \(v9\)/);
    assert.match(shim, /cobra só dedução \(v9\)/);
    // Regressão clássica: voltar a debitar settlementExchangeCommissionCents
    assert.doesNotMatch(
      prelive,
      /const commission = feeUpfront\s*\?\s*0\s*:\s*settlementExchangeCommissionCents/
    );
    assert.doesNotMatch(
      shim,
      /commission = feeUpfront\s*\?\s*0\s*:/
    );
    assert.doesNotMatch(prelive, /cobra dedução \+ comissão 4,5%/);
    assert.doesNotMatch(shim, /cobra dedução \+ comissão 4,5%/);
    assert.match(prelive, /Exchange incompleto/);
    assert.match(shim, /Exchange incompleto/);
    assert.match(prelive, /settle-exchange-heal-incompleto-v10/);
    assert.match(shim, /settle-exchange-heal-incompleto-v10/);
    assert.match(prelive, /exchangeWalletHealNeeded/);
    assert.match(shim, /exchangeWalletHealNeeded/);
    assert.match(prelive, /settlementOutcomeFromProtectionRow/);
    assert.match(shim, /settlementOutcomeFromProtectionRow/);
    assert.match(prelive, /Exchange settle sem user_id/);
    assert.match(shim, /Exchange settle sem user_id/);
    assert.match(prelive, /market_odd = approvedOdd|prevMeta\.market_odd = approvedOdd/);
    assert.match(shim, /prevMeta\.market_odd = approvedOdd/);
    // Modal admin não pode mais prometer 96,11 / comissão extra
    assert.match(admin, /liveExchangeDeductionCents|cobra só a dedução/);
    assert.match(admin, /stake_lock v9/);
    assert.doesNotMatch(admin, /cobra dedução \+ comissão 4,5%/);
    assert.doesNotMatch(admin, /stake_lock v7: Exchange = R\$ 0 Reembolso · destrava e devolve o stake · cobra dedução ArbiShield \+ comissão/);
  });
});

describe("Anti-regressão Sport×Cuiabá — odd 32 / heal incompleto", () => {
  const lock32 = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    odd: 32,
    metadata: {
      billing_model: "stake_lock_v1",
      stake_lock: true,
      market_type: "LAY",
      market_odd: 32,
    },
  };

  it("LAY 1000 @32 → fee R$15,81 · carteira 9.051,71", () => {
    const c = calcLay(100_000, 32);
    assert.equal(c.arbiShieldDeductionCents, 1581);
    assert.equal(settlementDeductionCents(lock32), 1581);
    assert.equal(806_752 + 100_000 - 1581, 905_171);
    assert.notEqual(settlementDeductionCents(lock32), 9111);
  });

  it("approved_odd 32 vence metadata.market_odd stale 10", () => {
    const row = {
      amount_cents: 100_000,
      responsibility_cents: 100_000,
      odd: 32,
      metadata: {
        billing_model: "stake_lock_v1",
        stake_lock: true,
        market_type: "LAY",
        market_odd: 10,
        contestation: { approved_odd: 32, contestation_approved: true },
      },
    };
    assert.equal(settlementMarketOdd(row), 32);
    assert.equal(settlementMarketType(row), "LAY");
    assert.equal(settlementDeductionCents(row), 1581);
  });

  it("tx zerada / sem stake_returned exige heal", () => {
    assert.equal(
      exchangeWalletHealNeeded(lock32, {
        hasTx: true,
        feeCharged: 0,
        unlocked: false,
        stakeReturned: false,
      }),
      true
    );
    assert.equal(
      exchangeWalletHealNeeded(lock32, {
        hasTx: true,
        feeCharged: 1581,
        unlocked: true,
        stakeReturned: true,
        feeShortfall: 0,
      }),
      false
    );
    assert.equal(
      exchangeWalletHealNeeded(lock32, { hasTx: false }),
      true
    );
  });

  it("outcome heal a partir de won_exchange", () => {
    assert.equal(
      settlementOutcomeFromProtectionRow({
        status: "won_exchange",
        settled_outcome: "exchange",
      }),
      "exchange"
    );
  });

  it("scripts odd10 hardcoded estão bloqueados por padrão", () => {
    for (const rel of [
      "scripts/vps-force-carlos-897641.mjs",
      "scripts/vps-ajustar-carlos-897641.mjs",
      "scripts/vps-reparar-carlos-stake-nao-voltou.mjs",
      "scripts/vps-forcar-descongelar-carlos.mjs",
      "scripts/vps-reparar-carlos-exchange-locked-stuck.mjs",
    ]) {
      const src = readFileSync(resolve(root, rel), "utf8");
      assert.match(src, /ALLOW_ODD10_TARGET/);
      assert.match(src, /BLOQUEADO|SUPERSEDED/);
    }
    const forceOk = readFileSync(
      resolve(root, "scripts/vps-force-carlos-905171.mjs"),
      "utf8"
    );
    assert.match(forceOk, /905_171|9\.051/);
    assert.match(forceOk, /15,?81|1581/);
  });
});
