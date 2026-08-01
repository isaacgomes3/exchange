/**
 * ============================================================================
 * CONTRATO TRAVADO — Fluxo de Proteção ArbiShield
 * ============================================================================
 * NÃO ALTERAR sem solicitação explícita do dono do produto.
 * Qualquer mudança aqui ou nos callers (prelive/shim/create-protection/UI)
 * deve ser pedida pelo usuário. Este módulo é a fonte da verdade das regras
 * de crédito no settle; os testes em protection-flow-contract.test.mjs
 * travam o comportamento no CI.
 *
 * Versão: protection-flow-contract-v10 (2026-07-27)
 *   Pedido explícito (2026-07-30): v10 é a ÚNICA fonte de verdade.
 *   Pedido explícito (2026-07-31): NEVER_CITE_OBSOLETE_PROTECTION_MODELS —
 *   respostas/PRs/docs de produto citam SOMENTE stake_lock_v1. Não nomear
 *   modelos antigos nem como “legado/histórico/obsoleto”.
 *
 *   Regra vigente (stake_lock_v1):
 *     - Ativação → trava stake; máx. 50% do Apostador RESTANTE naquele momento
 *       (evento 1: 50% da banca; evento 2: 50% do que sobrou; e assim por diante)
 *     - 1 operação por evento (user + match): não cria 2ª proteção no mesmo jogo
 *     - Entradas só ANTES do início (starts_at); após kickoff recusa
 *     - Ganhou na ArbiShield → credita stake (Saldo Reembolso) e destrava
 *     - Ganhou na Exchange → R$ 0 Reembolso; destrava e DEVOLVE o stake à origem;
 *       cobra SÓ a dedução ArbiShield da ODD CANÔNICA do bilhete
 *       (ex.: 1000@10 → R$ 91,11 · 1000@32 → R$ 15,81).
 *       A fatia Exchange 4,5% já entra no cálculo da dedução — NÃO debita de novo.
 *     - Heal: won_exchange com tx zerada/incompleta NÃO conta como creditado;
 *       reprocessa até isExchangeWalletComplete.
 *     - Empate Anula → destrava stake (devolve à origem)
 *     - Cancelar → destrava stake (devolve à origem)
 *     - LAY lucro fee = responsabilidade × (odd/(odd−1) − 1)
 *       ex.: 1000@10 → lucro 111,11 → Exchange 5 · cliente 15 · ArbiShield 91,11
 *       carteira: 8.067,52 + 1.000 − 91,11 = 8.976,41
 *       ex.: 1000@32 → lucro 32,26 → fee 15,81 → 8.067,52+1.000−15,81=9.051,71
 * ============================================================================
 */

export const PROTECTION_FLOW_CONTRACT_VERSION =
  "protection-flow-contract-v10";

/** Único modelo aceito para NOVAS proteções. */
export const PROTECTION_BILLING_MODEL_CANONICAL = "stake_lock_v1";

/**
 * Pedido explícito (2026-07-31): agentes/docs NÃO devem citar modelos antigos
 * ao descrever o fluxo — só stake_lock_v1.
 */
export const NEVER_CITE_OBSOLETE_PROTECTION_MODELS =
  "NEVER_CITE_OBSOLETE_PROTECTION_MODELS";

/**
 * Marker obrigatório em GET /health (prelive :3098 + shim :3101).
 * Pós-deploy e hotfixes falham se ausente ou se health ≠ stake_lock_v1.
 * Pedido explícito (anti-regressão 2026-07-30): fail-hard sob v10.
 */
export const PROTECTION_RUNTIME_HEALTH_MARKER =
  "protection-runtime-stake-lock-v10";

/** Marker `fix` no health — createProtection trava stake (não cobra fee). */
export const CREATE_PROTECTION_FIX_MARKER =
  "create-protection-stake-lock-v6";

/**
 * Blocklist INTERNA de runtime/health — não usar estes nomes em respostas
 * de produto (ver NEVER_CITE_OBSOLETE_PROTECTION_MODELS).
 */
export const PROTECTION_OBSOLETE_MODELS = Object.freeze([
  "fee_upfront_v1",
  "lock_fee_after_v1",
  "locked_margin_v2",
  "FLUXO_PROTECAO_V1",
  "fluxo-protecao-v1",
]);

/**
 * Health runtime: só OK se o processo vigente for stake_lock_v1 / v10.
 * Qualquer createProtectionModel fora do canônico → fail-hard (503).
 */
export function isProtectionRuntimeHealthy(health = {}) {
  const model = String(
    health.createProtectionModel || health.billingModel || ""
  ).trim();
  const contract = String(
    health.protectionFlowContract || health.contract || ""
  ).trim();
  const runtime = String(
    health.protectionRuntime || health.fix || ""
  ).trim();
  const blob = JSON.stringify(health);
  // Pedido 2026-07-31: health nunca pode citar modelo antigo
  if (/fee_upfront/i.test(blob)) return false;
  if (/locked_margin_v2|lock_fee_after|FLUXO_PROTECAO_V1/i.test(blob)) return false;
  if (/fee_upfront_v1/i.test(model)) return false;
  if (PROTECTION_OBSOLETE_MODELS.includes(model)) return false;
  if (model && model !== PROTECTION_BILLING_MODEL_CANONICAL) return false;
  if (
    contract &&
    contract !== PROTECTION_FLOW_CONTRACT_VERSION &&
    !contract.includes("v10")
  ) {
    return false;
  }
  if (
    runtime &&
    !runtime.includes("stake-lock") &&
    !runtime.includes("stake_lock")
  ) {
    return false;
  }
  return (
    model === PROTECTION_BILLING_MODEL_CANONICAL ||
    runtime.includes(PROTECTION_RUNTIME_HEALTH_MARKER) ||
    runtime.includes(CREATE_PROTECTION_FIX_MARKER)
  );
}

/**
 * LAY: lucro fee = responsabilidade × (backOdd − 1) = resp/(odd−1).
 * Ex.: 1000 @10 → 111,11 → dedução 91,11 (carteira: +1000 − 91,11).
 */
export const LAY_PROFIT_OVER_ODD_RULE = "lay-lucro-back-equiv-v9";

/**
 * Exchange: NÃO debita comissão 4,5% de novo na carteira —
 * já está líquida na dedução (lucro − 4,5% − 1,5%).
 * Pedido explícito: 8.067,52 + 1.000 − 91,11 = 8.976,41.
 */
export const EXCHANGE_NO_DOUBLE_COMMISSION_RULE =
  "settle-exchange-sem-comissao-extra-v9";

/** Marcador exigido pelos testes / hotfixes — não renomear. */
export const PROTECTION_FLOW_LOCK =
  "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST";

/**
 * Guarda anti-overcredit no cancel (pedido 2026-07-31):
 * health/UI/docs NÃO devem citar nomes de modelos antigos.
 * Marker público vigente:
 */
export const CANCEL_LEGACY_NO_STAKE_OVERCREDIT =
  "cancel-legacy-no-stake-overcredit-v10";

/**
 * Alias interno (hotfixes antigos ainda podem greppar o nome da constante).
 * Valor = marker público novo — nunca reemitir string com nome de modelo antigo.
 */
export const CANCEL_FEE_UPFRONT_NO_STAKE_REFUND =
  CANCEL_LEGACY_NO_STAKE_OVERCREDIT;

/**
 * Snapshot textual das regras vigentes — travado nos testes.
 * Alterar só com pedido explícito do dono + bump de versão.
 */
export const PROTECTION_FLOW_SPEC = Object.freeze({
  version: PROTECTION_FLOW_CONTRACT_VERSION,
  model: PROTECTION_BILLING_MODEL_CANONICAL,
  soleSourceOfTruth: true,
  neverCiteObsoleteModels: NEVER_CITE_OBSOLETE_PROTECTION_MODELS,
  obsoleteModels: PROTECTION_OBSOLETE_MODELS,
  lock: PROTECTION_FLOW_LOCK,
  runtimeHealthMarker: PROTECTION_RUNTIME_HEALTH_MARKER,
  createProtectionFixMarker: CREATE_PROTECTION_FIX_MARKER,
  requiresExplicitRequestToChange: true,
  activation: Object.freeze({
    locksStake: true,
    chargesDeductionOnCreate: false,
    maxFractionOfRemainingApostador: 0.5,
    successiveCapOnRemaining: true,
    oneOperationPerEvent: true,
    entryOnlyBeforeKickoff: true,
  }),
  outcomes: Object.freeze({
    arbishield: Object.freeze({
      creditStakeToReembolso: true,
      unlock: true,
      chargeDeduction: false,
    }),
    exchange: Object.freeze({
      creditReembolso: false,
      creditTotal: 0,
      chargeDeductionOnly: true,
      /** Pedido explícito 2026-07-27: destrava E devolve o stake à origem. */
      unlockWithoutReturn: false,
      unlockReturnToOrigin: true,
      /** 4,5% já líquido na dedução — não debita de novo na carteira. */
      chargeExchangeCommission: false,
    }),
    void: Object.freeze({
      unlockReturnToOrigin: true,
      creditReembolso: false,
    }),
    cancel: Object.freeze({
      unlockReturnToOrigin: true,
    }),
  }),
});

/** Marker da regra vigente. */
export const STAKE_LOCK_RULE = "stake-lock-v1";

/**
 * Guarda Exchange/PERDEU: R$ 0 Reembolso · destrava e devolve stake ·
 * cobra SÓ dedução ArbiShield (sem comissão Exchange extra na carteira).
 * Hotfix / health / CI devem conter esta string.
 */
export const EXCHANGE_CHARGE_DEDUCTION_RULE =
  "settle-exchange-cobra-so-deducao-v9";

/**
 * Heal anti-regressão: tx R$0 / parcial NÃO bloqueia reprocesso Exchange.
 * Marker exigido em prelive/shim/CI — não renomear.
 */
export const EXCHANGE_INCOMPLETE_HEAL_RULE =
  "settle-exchange-heal-incompleto-v10";

/**
 * Odd canônica do settle: approved_odd > calculations.marketOdd >
 * metadata.market_odd > row.odd. Evita fee @10 em bilhete @32.
 */
export const SETTLEMENT_ODD_CANONICAL_RULE = "settlement-odd-canonico-v10";

/** Alias v7 (ainda citado em hotfixes antigos). */
export const EXCHANGE_CHARGE_DEDUCTION_RULE_V7 =
  "settle-exchange-devolve-cobra-v7";

/** Alias histórico (anti-crédito Reembolso). */
export const EXCHANGE_NO_CREDIT_RULE = "settle-exchange-nunca-reembolso-v1";

/** Alias do marker v6 (ainda citado em hotfixes antigos). */
export const EXCHANGE_CHARGE_DEDUCTION_RULE_V6 =
  "settle-exchange-cobra-deducao-v6";

/**
 * Comissão Exchange a debitar na carteira no settle.
 * v9: sempre 0 — a fatia 4,5% já sai no cálculo da dedução.
 * Qualquer caller que debitar settlementExchangeCommissionCents de novo
 * reintroduz o erro 8.982,52 em vez de 8.976,41.
 */
export function settlementExchangeCommissionWalletCents(_row) {
  void EXCHANGE_NO_DOUBLE_COMMISSION_RULE;
  void EXCHANGE_CHARGE_DEDUCTION_RULE;
  return 0;
}

/**
 * Débito total na carteira no PERDEU/Exchange (stake_lock):
 * só a dedução ArbiShield. Comissão wallet = 0.
 */
export function exchangeWalletChargeCents(row) {
  return Math.max(0, settlementDeductionCents(row)) +
    Math.max(0, settlementExchangeCommissionWalletCents(row));
}

/** Fração máxima do saldo Apostador que pode ser travada na ativação. */
export const MAX_STAKE_FRACTION_OF_APOSTADOR = 0.5;

/** Cliente: no máximo uma proteção por evento (match). */
export const ONE_OPERATION_PER_EVENT = true;

/** Cliente: entradas apenas antes de starts_at (kickoff). */
export const ENTRY_BEFORE_KICKOFF_ONLY = true;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
}

/**
 * Evento já começou (now >= starts_at) → não aceita nova entrada.
 * @param {unknown} startsAt
 * @param {number} [nowMs]
 */
export function isMatchKickoffPassed(startsAt, nowMs = Date.now()) {
  if (startsAt == null || startsAt === "") return false;
  const t = new Date(startsAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Number(nowMs) >= t;
}

/** Status que libera nova tentativa no mesmo evento (operação desfeita). */
export function isCancelledProtectionStatus(status) {
  const s = String(status || "")
    .toLowerCase()
    .trim();
  return (
    s === "cancelled" ||
    s === "canceled" ||
    s === "refunded" ||
    s === "pending_refund"
  );
}

/**
 * Teto de stake na ativação: 50% do saldo Apostador líquido restante AGORA.
 * Locked ativo já saiu do disponível (debito na criação), então cada novo
 * evento recalcula sobre o que sobrou — sucessivo, não 50% da banca original.
 *
 * Ex.: disponível 100_000 → máx 50_000; após travar 50_000 resta 50_000 → máx 25_000.
 *
 * @param {number} apostadorAvailableCents saldo líquido atual (sem locked)
 */
export function maxStakeLockCents(apostadorAvailableCents) {
  const avail = Math.max(0, n(apostadorAvailableCents));
  return Math.floor(avail * MAX_STAKE_FRACTION_OF_APOSTADOR);
}

/**
 * Saldo Apostador após uma trava (para simular eventos sucessivos).
 * @param {number} apostadorAvailableCents
 * @param {number} lockCents
 */
export function apostadorRemainingAfterLock(apostadorAvailableCents, lockCents) {
  return Math.max(0, n(apostadorAvailableCents) - Math.max(0, n(lockCents)));
}

/**
 * Empate Anula / Draw No Bet / void / push — não bateu Arbi nem casa.
 * @param {unknown} outcome
 */
export function isVoidSettleOutcome(outcome) {
  const o = String(outcome || "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  return (
    o === "void" ||
    o === "empate_anula" ||
    o === "anula" ||
    o === "draw" ||
    o === "push" ||
    o === "dnb" ||
    o === "draw_no_bet"
  );
}

export function normalizeSettleOutcome(outcome) {
  const o = String(outcome || "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (o === "arbishield" || o === "exchange") return o;
  if (isVoidSettleOutcome(o)) return "void";
  return o;
}

/** Proteções criadas no modelo antigo (só cobrava dedução na ativação). */
export function isFeeUpfrontProtection(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (meta.billing_model === "stake_lock_v1" || meta.stake_lock === true) {
    return false;
  }
  if (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  ) {
    return true;
  }
  // Create cobrou fee na ativação (fee_charged_cents) sem marker stake_lock
  // → trata como histórico fee_upfront (evita cancel devolver stake).
  if (n(meta.fee_charged_cents) > 0) return true;
  return false;
}

/** Modelo vigente: trava stake na ativação. */
export function isStakeLockProtection(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (meta.billing_model === "stake_lock_v1" || meta.stake_lock === true) {
    return true;
  }
  // Sem marker fee_upfront → trata como trava stake (legado / vigente)
  return !isFeeUpfrontProtection(row);
}

/**
 * Quanto creditar no cancelamento (origem).
 * fee_upfront → só dedução · stake_lock → stake.
 * Nunca devolver stake se a ativação cobrou fee_upfront.
 * Marker: cancel-fee-upfront-nao-devolve-stake-v6
 */
export function cancelRefundCents(row) {
  void CANCEL_FEE_UPFRONT_NO_STAKE_REFUND;
  const stake = n(row?.responsibility_cents || row?.amount_cents);
  const fee = settlementDeductionCents(row);
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  // Guarda absoluta: stake_lock explícito nunca devolve só fee
  if (meta.billing_model === "stake_lock_v1" || meta.stake_lock === true) {
    return stake;
  }
  // fee_upfront (markers ou fee cobrada na criação) → só a dedução
  if (isFeeUpfrontProtection(row)) {
    return fee;
  }
  return stake;
}

/** Marker: cancel stake_lock deve devolver stake (anti-regressão). */
export const CANCEL_STAKE_LOCK_RETURN_STAKE =
  "cancel-stake-lock-devolve-stake-v6";

/**
 * Exchange/PERDEU wallet completo?
 * - fee_upfront: só auditoria (taxa já cobrada na criação)
 * - stake_lock: precisa devolver stake (se havia) + destravar + cobrir a dedução
 *   (feeCharged + feeShortfall >= feeExpected)
 * Marker: settle-exchange-devolve-cobra-v7
 */
export function isExchangeWalletComplete({
  feeUpfront = false,
  feeExpected = 0,
  feeCharged = 0,
  feeShortfall = 0,
  unlocked = false,
  needsUnlock = false,
  stakeReturned = false,
  needsReturn = false,
} = {}) {
  void EXCHANGE_CHARGE_DEDUCTION_RULE;
  if (feeUpfront) return true;
  if (needsUnlock && !unlocked) return false;
  if (needsReturn && !stakeReturned) return false;
  const fee = Math.max(0, n(feeExpected));
  if (!(fee > 0)) return true;
  return Math.max(0, n(feeCharged)) + Math.max(0, n(feeShortfall)) >= fee;
}

/**
 * Odd canônica para fee/settle (anti fee @10 em bilhete @32).
 * Prioridade: contestation.approved_odd → calculations.marketOdd →
 * metadata.market_odd → row.odd.
 */
export function settlementMarketOdd(row) {
  void SETTLEMENT_ODD_CANONICAL_RULE;
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const contest =
    meta.contestation && typeof meta.contestation === "object"
      ? meta.contestation
      : {};
  const metaCalc =
    meta.calculations && typeof meta.calculations === "object"
      ? meta.calculations
      : {};
  const rowCalc =
    row?.calculations && typeof row.calculations === "object"
      ? row.calculations
      : {};
  const candidates = [
    contest.approved_odd,
    metaCalc.marketOdd,
    metaCalc.market_odd,
    rowCalc.marketOdd,
    rowCalc.market_odd,
    meta.market_odd,
    row?.odd,
  ];
  for (const c of candidates) {
    const o = Number(c);
    if (o > 1.01) return o;
  }
  return 0;
}

/**
 * Tipo de mercado canônico. Sem marker: LAY em `protections`, BACK em
 * `back_protections`. Nunca assume BACK em LAY de odd alta (fee inflada).
 */
export function settlementMarketType(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const mt = String(
    meta.market_type || meta.side || row?.market_type || ""
  ).toUpperCase();
  if (mt === "LAY" || mt === "BACK") return mt;
  const table = String(row?._table || row?.table || "").toLowerCase();
  if (table.includes("back")) return "BACK";
  return "LAY";
}

/**
 * Lucro bruto usado nas fees.
 * - LAY: responsabilidade × (backOdd − 1) = resp/(odd−1)
 *   (marker lay-lucro-back-equiv-v9) — ex. 1000@10 → 111,11
 * - BACK: stake × (odd − 1)
 */
export function grossProfitCentsForFees(stakeCents, marketOdd, marketType) {
  void LAY_PROFIT_OVER_ODD_RULE;
  const stake = n(stakeCents);
  const odd = Number(marketOdd);
  const mt = String(marketType || "").toUpperCase();
  if (!(stake > 0) || !(odd > 1.01)) return 0;
  if (mt === "LAY") {
    const backOdd = odd / (odd - 1);
    return Math.max(0, Math.round(stake * backOdd) - stake);
  }
  return Math.max(0, Math.round(stake * odd) - stake);
}

/**
 * Recalcula dedução vigente a partir de stake/odd:
 * lucro bruto − comissão 4,5% − lucro usuário 1,5%.
 */
export function computeArbiShieldDeductionCents(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const stake = n(
    row?.responsibility_cents || row?.amount_cents || meta.stake_cents
  );
  const odd = settlementMarketOdd(row);
  const mt = settlementMarketType(row);
  if (!(stake > 0) || !(odd > 1.01)) return 0;
  const profit = grossProfitCentsForFees(stake, odd, mt);
  const commission = exchangeCommissionCentsFromProfit(profit);
  const userProfit = Math.round(stake * 0.015);
  return Math.max(0, profit - commission - userProfit);
}

/**
 * won_exchange precisa reprocessar carteira?
 * Tx R$0 / sem stake_returned / fee parcial → true (heal v10).
 */
export function exchangeWalletHealNeeded(row, prior = {}) {
  void EXCHANGE_INCOMPLETE_HEAL_RULE;
  void EXCHANGE_CHARGE_DEDUCTION_RULE;
  const feeUpfront = isFeeUpfrontProtection(row);
  const amount = n(row?.responsibility_cents || row?.amount_cents);
  const stakeLock = isStakeLockProtection(row);
  const needsUnlock = (stakeLock || !feeUpfront) && amount > 0;
  const needsReturn = stakeLock && !feeUpfront && amount > 0;
  const fee = settlementDeductionCents(row);
  if (!prior || prior.hasTx !== true) return true;
  return !isExchangeWalletComplete({
    feeUpfront,
    feeExpected: fee,
    feeCharged: prior.feeCharged || 0,
    feeShortfall: prior.feeShortfall || 0,
    unlocked: prior.unlocked || !needsUnlock,
    needsUnlock,
    stakeReturned: prior.stakeReturned || !needsReturn,
    needsReturn,
  });
}

/** Outcome efetivo para heal a partir do status/settled_outcome da linha. */
export function settlementOutcomeFromProtectionRow(row) {
  const stored = normalizeSettleOutcome(row?.settled_outcome || "");
  if (stored === "arbishield" || stored === "exchange" || stored === "void") {
    return stored;
  }
  const st = String(row?.status || "")
    .toLowerCase()
    .trim();
  if (st === "won_exchange") return "exchange";
  if (st === "lost_exchange" || st === "won_platform" || st === "lost_platform") {
    return "arbishield";
  }
  if (st === "cancelled" || st === "canceled" || st === "void") return "void";
  return "";
}

function storedPlatformDeductionCents(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const raw =
    row?.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row?.platform_profit_cents != null
        ? row.platform_profit_cents
        : meta.fee_charged_cents != null
          ? meta.fee_charged_cents
          : row?.locked_deduction_cents;
  return Math.max(0, n(raw));
}

/**
 * Dedução ArbiShield (cobrada no PERDEU).
 * - fee_upfront histórico: respeita stored (já cobrado na criação).
 * - stake_lock: sempre fórmula vigente (lucro − 4,5% − 1,5%)
 *   (ignora stored antigo 8050/9611). Carteira cobra SÓ essa dedução.
 */
export function settlementDeductionCents(row) {
  if (isFeeUpfrontProtection(row)) {
    const stored = storedPlatformDeductionCents(row);
    if (stored > 0) return stored;
    return computeArbiShieldDeductionCents(row);
  }
  const computed = computeArbiShieldDeductionCents(row);
  if (computed > 0) return computed;
  return storedPlatformDeductionCents(row);
}

/**
 * Regras de crédito no settle (TRAVADAS) — stake_lock_v1:
 *
 *   - Ganhou na ArbiShield → stake (Saldo Reembolso) + destrava
 *   - Ganhou na Exchange   → 0 Reembolso; destrava e DEVOLVE stake à origem;
 *     cobra SÓ dedução (caller NÃO debita comissão 4,5% de novo)
 *   - Empate Anula / void → stake (caller destrava/devolve à origem — NÃO Reembolso)
 *
 * Ativação: trava stake; máx. 50% do Apostador restante naquele momento
 * (recalcula a cada evento sobre o que sobrou após travas anteriores).
 *
 * Histórico fee_upfront_v1 (só linhas antigas):
 *   - ArbiShield → stake + dedução (Reembolso)
 *   - Exchange   → 0
 *   - void → só dedução (Reembolso)
 *
 * Marker: settle-exchange-nunca-reembolso-v1 · settle-exchange-devolve-cobra-v7 · stake-lock-v1
 */
export function settlementCreditParts(row, outcome) {
  const amount = n(row?.responsibility_cents || row?.amount_cents);
  const fee = settlementDeductionCents(row);
  const o = normalizeSettleOutcome(outcome);
  const wonArbi = o === "arbishield";
  const isVoid = o === "void";

  // PERDEU / Exchange: nunca credita
  if (!wonArbi && !isVoid) {
    return { stake: 0, fee: 0, total: 0 };
  }

  // Histórico fee_upfront
  if (isFeeUpfrontProtection(row)) {
    if (isVoid) return { stake: 0, fee, total: fee };
    return { stake: amount, fee, total: amount + fee };
  }

  // Vigente stake_lock: Arbi ou void → stake (destino do void = origem, no caller)
  return { stake: amount, fee: 0, total: amount };
}

export function settlementCreditCents(row, outcome) {
  return settlementCreditParts(row, outcome).total;
}

/**
 * Bucket de crédito após settle:
 * - ArbiShield → sempre Saldo Reembolso
 * - void stake_lock → carteira de origem (balance); fee_upfront void → Reembolso
 */
export function creditBucketForSettlement(_balanceType, row, outcome) {
  const o = normalizeSettleOutcome(outcome);
  if (o === "void" && isStakeLockProtection(row)) {
    const bt = String(
      (row &&
        row.metadata &&
        (row.metadata.balance_type ||
          row.metadata.balance_type_requested ||
          row.metadata.balanceType)) ||
        _balanceType ||
        "REAL"
    ).toUpperCase();
    if (bt === "DEMO") return "demo_balance_cents";
    if (bt === "INVESTOR") return "investor_balance_cents";
    return "balance_cents";
  }
  return "deduction_balance_cents";
}

/** Status persistido na proteção conforme outcome. */
export function settlementStatusForOutcome(outcome) {
  const o = normalizeSettleOutcome(outcome);
  if (o === "arbishield") return "lost_exchange";
  if (o === "void") return "void";
  return "won_exchange";
}

/**
 * fee_upfront / dedução.
 * amountCents = cobertura (LAY=responsabilidade · BACK=stake).
 *
 * Fórmula (pedido explícito v9):
 *   lucro bruto (LAY = resp/(odd−1) · BACK = stake×(odd−1))
 *   − comissão Exchange 4,5% do lucro   ← só no cálculo
 *   − lucro usuário 1,5% da cobertura
 *   = dedução ArbiShield (única cobrança na carteira no PERDEU)
 *
 * Ex. LAY 1000 @10 → lucro 111,11 → Exchange 5,00 · cliente 15 · ArbiShield 91,11
 * Carteira: 8.067,52 + 1.000 − 91,11 = 8.976,41
 */
export const EXCHANGE_COMMISSION_RATE = 0.045;

export function exchangeCommissionCentsFromProfit(grossProfitCents) {
  return Math.max(
    0,
    Math.round(Math.max(0, n(grossProfitCents)) * EXCHANGE_COMMISSION_RATE)
  );
}

/** Comissão Exchange persistida / recalculada (4,5% do lucro). */
export function settlementExchangeCommissionCents(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const raw =
    row?.exchange_fee_cents != null
      ? row.exchange_fee_cents
      : meta.exchange_commission_cents != null
        ? meta.exchange_commission_cents
        : meta.exchange_fee_cents;
  let fee = Math.max(0, n(raw));
  if (fee > 0) return fee;
  const gross =
    meta.gross_profit_cents != null
      ? n(meta.gross_profit_cents)
      : row?.exchange_profit_net_cents != null
        ? n(row.exchange_profit_net_cents)
        : 0;
  if (gross > 0) return exchangeCommissionCentsFromProfit(gross);
  // Recalcula lucro a partir de stake/odd se necessário
  const stake = n(
    row?.responsibility_cents || row?.amount_cents || meta.stake_cents
  );
  let odd = Number(meta.market_odd);
  if (!(odd > 1.01)) odd = Number(row?.odd || 0);
  const mt = String(meta.market_type || "").toUpperCase();
  if (stake > 0 && odd > 1.01) {
    const profit = grossProfitCentsForFees(stake, odd, mt || "BACK");
    return exchangeCommissionCentsFromProfit(profit);
  }
  return 0;
}

/** BACK (e helper genérico): amountCents = stake; lucro = stake×(odd−1). */
export function calcFeeUpfront(amountCents, odd) {
  const coverage =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const grossReturnCents = Math.round(coverage * o);
  const grossProfitCents = Math.max(0, grossReturnCents - coverage);
  const exchangeCommissionCents =
    exchangeCommissionCentsFromProfit(grossProfitCents);
  const userProfitCents = Math.round(coverage * 0.015);
  // lucro − 4,5% − 1,5% = dedução
  const arbiShieldDeductionCents = Math.max(
    0,
    grossProfitCents - exchangeCommissionCents - userProfitCents
  );
  return {
    stakeCents: coverage,
    responsibilityCents: coverage,
    coverageCents: coverage,
    odd: o,
    effectiveBackOdd: o,
    grossReturnCents,
    grossProfitCents,
    userProfitCents,
    arbiShieldDeductionCents,
    /** Comissão Exchange 4,5% sobre o lucro (cobrada só no PERDEU/Exchange). */
    exchangeCommissionCents,
    exchangeFeeCents: exchangeCommissionCents,
    exchange_commission_rate: EXCHANGE_COMMISSION_RATE,
    billing_model: "stake_lock_v1",
  };
}

export function layToBackOdd(layOdd) {
  const o = Number.isFinite(layOdd) && layOdd > 1.01 ? layOdd : 1.01;
  return o / (o - 1);
}

/**
 * LAY: amountCents = responsabilidade.
 * Lucro fee = resp/(odd−1). Ex.: 1000 @10 → 111,11 − 5 − 15 = 91,11.
 * Carteira no PERDEU cobra só 91,11 (sem comissão extra).
 */
export function calcLay(amountCents, odd) {
  const marketOdd = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const backOdd = layToBackOdd(marketOdd);
  const liability =
    Number.isFinite(amountCents) && amountCents > 0
      ? Math.floor(amountCents)
      : 0;
  const c = calcFeeUpfront(liability, backOdd);
  const houseStakeCents =
    marketOdd > 1.01 ? Math.round(liability / (marketOdd - 1)) : 0;
  return {
    ...c,
    odd: marketOdd,
    stakeCents: houseStakeCents,
    responsibilityCents: liability,
    coverageCents: liability,
    marketOdd,
    effectiveBackOdd: backOdd,
    input_mode: "responsabilidade",
  };
}

/** BACK: amountCents = stake. */
export function calcBack(amountCents, odd) {
  return { ...calcFeeUpfront(amountCents, odd), input_mode: "stake" };
}

/**
 * Vocabulário único do resultado (marker: `protection-result-terms-v1`).
 * Espelhado em `deploy/vps-supabase/static/v2/v2.js` → ArbiV2.protectionResultTerm.
 *
 * Só nomenclatura — não muda crédito/destravamento do `stake_lock_v1`:
 *   - indicação perde  → Reembolso (`arbishield`)
 *   - indicação ganha  → Ganho     (`exchange`)
 *   - empate anula     → Anula     (`void`)
 */
export const PROTECTION_RESULT_TERMS_VERSION = "protection-result-terms-v1";

export const PROTECTION_RESULT_TERMS = Object.freeze({
  arbishield: Object.freeze({
    term: "Reembolso",
    kind: "reembolso",
    hint: "Indicação perdeu — destrava o stake e ArbiShield credita no Saldo Reembolso",
  }),
  exchange: Object.freeze({
    term: "Ganho",
    kind: "ganho",
    hint: "Indicação bateu na casa externa — devolve o stake à origem e cobra só a dedução",
  }),
  void: Object.freeze({
    term: "Anula",
    kind: "anula",
    hint: "Empate anula — destrava o stake e devolve à origem",
  }),
});

/** Normaliza outcome para chave de PROTECTION_RESULT_TERMS (inclui status legado). */
export function normalizeProtectionResultOutcome(outcome) {
  const o = String(outcome == null ? "" : outcome)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (o === "arbishield" || o === "lost_exchange") return "arbishield";
  if (o === "exchange" || o === "won_exchange") return "exchange";
  if (isVoidSettleOutcome(o)) return "void";
  return "";
}

export function protectionResultTerm(outcome) {
  return PROTECTION_RESULT_TERMS[normalizeProtectionResultOutcome(outcome)]?.term || "";
}

export function protectionResultKind(outcome) {
  return PROTECTION_RESULT_TERMS[normalizeProtectionResultOutcome(outcome)]?.kind || "";
}

export function protectionResultHint(outcome) {
  return PROTECTION_RESULT_TERMS[normalizeProtectionResultOutcome(outcome)]?.hint || "";
}
