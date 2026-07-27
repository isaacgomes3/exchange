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
 * Versão: protection-flow-contract-v11 (2026-07-27)
 *   Pedido explícito: fee_upfront_v1 volta a ser o modelo ativo.
 *
 *   Regra vigente (fee_upfront_v1):
 *     - Ativação → cobra só a taxa ArbiShield; não trava stake
 *     - Responsabilidade/stake continua limitada a 50% do Apostador restante
 *       (evento 1: 50% da banca; evento 2: 50% do que sobrou; e assim por diante)
 *     - 1 operação por evento (user + match): não cria 2ª proteção no mesmo jogo
 *     - Entradas só ANTES do início (starts_at); após kickoff recusa
 *     - Fee = lucro bruto − lucro do usuário (1,5%); Exchange 4,5% é informativa
 *       (ex.: LAY 1000@10 → R$ 96,11 · 1000@32 → R$ 17,26)
 *     - Ganhou na ArbiShield → pending_refund; exige comprovante, sem crédito automático
 *     - Ganhou na Exchange → R$ 0; taxa já cobrada; sem retorno de stake
 *     - Heal: won_exchange com tx zerada/incompleta NÃO conta como creditado;
 *       reprocessa até isExchangeWalletComplete.
 *     - Empate Anula → devolve só a taxa ao Saldo Reembolso
 *     - Cancelar → devolve só a taxa
 *     - LAY lucro fee = responsabilidade × (odd/(odd−1) − 1)
 *       ex.: 1000@10 → lucro 111,11 · cliente 15 · taxa ArbiShield 96,11
 *       ex.: 1000@32 → lucro 32,26 · cliente 15 · taxa ArbiShield 17,26
 *
 *   Histórico stake_lock_v1: mantém settle antigo (crédito/destrava/devolve).
 *   Cancel fee_upfront → estorna SÓ a dedução (nunca o stake).
 *   Guarda: cancel-fee-upfront-nao-devolve-stake-v6
 * ============================================================================
 */

export const PROTECTION_FLOW_CONTRACT_VERSION =
  "protection-flow-contract-v11";

/** Markers do pedido explícito v11 — não renomear. */
export const FEE_UPFRONT_ACTIVE_RULE = "fee-upfront-ativo-v11";
export const ARBISHIELD_REQUIRES_PROOF_RULE =
  "arbishield-exige-comprovante-v11";
export const FEE_FORMULA_GROSS_MINUS_USER = "fee-lucro-menos-1_5-v11";

/**
 * LAY: lucro fee = responsabilidade × (backOdd − 1) = resp/(odd−1).
 * Ex.: 1000 @10 → lucro 111,11 (taxa ativa v11 = 96,11).
 */
export const LAY_PROFIT_OVER_ODD_RULE = "lay-lucro-back-equiv-v9";

/**
 * Guarda histórica stake_lock: NÃO debita comissão 4,5% de novo na carteira,
 * pois ela já está líquida na dedução antiga (lucro − 4,5% − 1,5%).
 * No fee_upfront v11 a comissão também é somente informativa.
 */
export const EXCHANGE_NO_DOUBLE_COMMISSION_RULE =
  "settle-exchange-sem-comissao-extra-v9";

/** Marcador exigido pelos testes / hotfixes — não renomear. */
export const PROTECTION_FLOW_LOCK =
  "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST";

/**
 * Guarda anti-overcredit no cancel: fee_upfront nunca devolve stake.
 * Hotfix / health devem conter esta string.
 */
export const CANCEL_FEE_UPFRONT_NO_STAKE_REFUND =
  "cancel-fee-upfront-nao-devolve-stake-v6";

/**
 * Snapshot textual das regras vigentes — travado nos testes.
 * Alterar só com pedido explícito do dono + bump de versão.
 */
export const PROTECTION_FLOW_SPEC = Object.freeze({
  version: PROTECTION_FLOW_CONTRACT_VERSION,
  model: "fee_upfront_v1",
  lock: PROTECTION_FLOW_LOCK,
  requiresExplicitRequestToChange: true,
  activation: Object.freeze({
    locksStake: false,
    chargesDeductionOnCreate: true,
    maxFractionOfRemainingApostador: 0.5,
    successiveCapOnRemaining: true,
    oneOperationPerEvent: true,
    entryOnlyBeforeKickoff: true,
  }),
  outcomes: Object.freeze({
    arbishield: Object.freeze({
      creditStakeToReembolso: false,
      unlock: false,
      chargeDeduction: false,
      requiresProof: true,
    }),
    exchange: Object.freeze({
      creditReembolso: false,
      creditTotal: 0,
      chargeDeductionOnly: false,
      unlockWithoutReturn: false,
      unlockReturnToOrigin: false,
      chargeExchangeCommission: false,
    }),
    void: Object.freeze({
      unlockReturnToOrigin: false,
      creditReembolso: true,
      refundFeeOnly: true,
    }),
    cancel: Object.freeze({
      unlockReturnToOrigin: false,
      refundFeeOnly: true,
    }),
  }),
});

/** Marker do modelo histórico que ainda deve liquidar pelas regras antigas. */
export const STAKE_LOCK_RULE = "stake-lock-v1";

/**
 * Guarda Exchange/PERDEU histórica: R$ 0 Reembolso · stake_lock destrava e
 * devolve stake · cobra só dedução (sem comissão Exchange extra).
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
 * Sempre 0: fee_upfront v11 já cobrou a taxa; stake_lock histórico já inclui
 * a fatia 4,5% no cálculo da dedução antiga.
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

/** Fração máxima do saldo Apostador para a responsabilidade/stake da proteção. */
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

/** Modelo ativo: taxa cobrada na ativação, sem trava de stake. */
export function isFeeUpfrontProtection(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (
    meta.billing_model === "stake_lock_v1" ||
    meta.stake_lock === true ||
    String(meta.source || "").includes("stake_lock")
  ) {
    return false;
  }
  if (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  ) {
    return true;
  }
  // Create cobrou fee na ativação sem marker stake_lock → fee_upfront.
  if (n(meta.fee_charged_cents) > 0) return true;
  // v11: linhas sem marker stake_lock seguem o modelo vigente.
  return true;
}

/** Modelo histórico: trava stake na ativação. Só markers explícitos entram aqui. */
export function isStakeLockProtection(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return (
    meta.billing_model === "stake_lock_v1" ||
    meta.stake_lock === true ||
    String(meta.source || "").includes("stake_lock")
  );
}

/**
 * Vitória ArbiShield no modelo ativo aguarda comprovante.
 * Apenas stake_lock_v1 explicitamente histórico mantém crédito automático.
 */
export function arbishieldRequiresProof(row) {
  void ARBISHIELD_REQUIRES_PROOF_RULE;
  return !isStakeLockProtection(row);
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
 * Recalcula dedução a partir de stake/odd:
 * - fee_upfront vigente (inclusive sem marker): lucro bruto − usuário 1,5%
 * - stake_lock histórico explícito: lucro bruto − Exchange 4,5% − usuário 1,5%
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
  const userProfit = Math.round(stake * 0.015);
  const commission = isStakeLockProtection(row)
    ? exchangeCommissionCentsFromProfit(profit)
    : 0;
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
 * - fee_upfront vigente: respeita stored (já cobrado na criação).
 * - stake_lock histórico: sempre fórmula antiga (lucro − 4,5% − 1,5%)
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
 * Valores elegíveis no settle (o caller adia Arbi fee_upfront até comprovante):
 *
 *   - Ganhou na ArbiShield → stake (Saldo Reembolso) + destrava
 *   - Ganhou na Exchange   → 0 Reembolso; destrava e DEVOLVE stake à origem;
 *     cobra SÓ dedução (caller NÃO debita comissão 4,5% de novo)
 *   - Empate Anula / void → stake (caller destrava/devolve à origem — NÃO Reembolso)
 *
 * Ativação: trava stake; máx. 50% do Apostador restante naquele momento
 * (recalcula a cada evento sobre o que sobrou após travas anteriores).
 *
 * Fee_upfront_v1 vigente:
 *   - ArbiShield → stake + dedução elegíveis, sem crédito automático
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

  // Fee_upfront vigente: o total é elegível, mas o caller exige comprovante.
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

/** Status persistido na proteção conforme outcome e modelo da linha. */
export function settlementStatusForOutcome(outcome, row) {
  const o = normalizeSettleOutcome(outcome);
  if (o === "arbishield") {
    return arbishieldRequiresProof(row) ? "pending_refund" : "lost_exchange";
  }
  if (o === "void") return "void";
  return "won_exchange";
}

/**
 * fee_upfront / dedução.
 * amountCents = cobertura (LAY=responsabilidade · BACK=stake).
 *
 * Fórmula ativa (pedido explícito v11):
 *   lucro bruto (LAY = resp/(odd−1) · BACK = stake×(odd−1))
 *   − lucro usuário 1,5% da cobertura
 *   = taxa ArbiShield cobrada na ativação
 *
 * A comissão Exchange 4,5% continua calculada apenas como informação.
 * Ex. LAY 1000 @10 → lucro 111,11 · cliente 15 · taxa 96,11.
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
  // fee-lucro-menos-1_5-v11: NÃO subtrair Exchange 4,5% da taxa cobrada.
  void FEE_FORMULA_GROSS_MINUS_USER;
  const arbiShieldDeductionCents = Math.max(
    0,
    grossProfitCents - userProfitCents
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
    /** Comissão Exchange 4,5% sobre o lucro (somente informativa). */
    exchangeCommissionCents,
    exchangeFeeCents: exchangeCommissionCents,
    exchange_commission_rate: EXCHANGE_COMMISSION_RATE,
    billing_model: "fee_upfront_v1",
  };
}

export function layToBackOdd(layOdd) {
  const o = Number.isFinite(layOdd) && layOdd > 1.01 ? layOdd : 1.01;
  return o / (o - 1);
}

/**
 * LAY: amountCents = responsabilidade.
 * Lucro fee = resp/(odd−1). Ex.: 1000 @10 → 111,11 − 15 = 96,11.
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
