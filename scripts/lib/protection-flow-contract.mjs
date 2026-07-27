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
 * Versão: protection-flow-contract-v6 (2026-07-27)
 *   Regra vigente (stake_lock_v1):
 *     - Ativação → trava stake; máx. 50% do Apostador RESTANTE naquele momento
 *       (evento 1: 50% da banca; evento 2: 50% do que sobrou; e assim por diante)
 *     - 1 operação por evento (user + match): não cria 2ª proteção no mesmo jogo
 *     - Entradas só ANTES do início (starts_at); após kickoff recusa
 *     - Ganhou na ArbiShield → credita stake (Saldo Reembolso) e destrava
 *     - Ganhou na Exchange → R$ 0; cobra só a dedução; destrava sem devolver
 *     - Empate Anula → destrava stake (devolve à origem)
 *     - Cancelar → destrava stake (devolve à origem)
 *
 *   Histórico fee_upfront_v1 (linhas antigas): mantido só para settle/cancel
 *   de proteções já criadas com billing_model fee_upfront_v1.
 * ============================================================================
 */

export const PROTECTION_FLOW_CONTRACT_VERSION =
  "protection-flow-contract-v6";

/** Marcador exigido pelos testes / hotfixes — não renomear. */
export const PROTECTION_FLOW_LOCK =
  "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST";

/**
 * Snapshot textual das regras vigentes — travado nos testes.
 * Alterar só com pedido explícito do dono + bump de versão.
 */
export const PROTECTION_FLOW_SPEC = Object.freeze({
  version: PROTECTION_FLOW_CONTRACT_VERSION,
  model: "stake_lock_v1",
  lock: PROTECTION_FLOW_LOCK,
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
      unlockWithoutReturn: true,
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
  return (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  );
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
 * Dedução ArbiShield (cobrada no PERDEU; calculada/armazenada na criação).
 */
export function settlementDeductionCents(row) {
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
  let fee = Math.max(0, n(raw));
  if (!(fee > 0)) {
    const stake = n(
      row?.responsibility_cents || row?.amount_cents || meta.stake_cents
    );
    let odd = Number(meta.market_odd);
    if (!(odd > 1.01)) odd = Number(row?.odd || 0);
    const mt = String(meta.market_type || "").toUpperCase();
    if (mt === "LAY" && odd > 1.01) odd = odd / (odd - 1);
    if (stake > 0 && odd > 1.01) {
      const profit = Math.max(0, Math.round(stake * odd) - stake);
      const userProfit = Math.round(stake * 0.015);
      fee = Math.max(0, profit - userProfit);
    }
  }
  return fee;
}

/**
 * Regras de crédito no settle (TRAVADAS) — stake_lock_v1:
 *
 *   - Ganhou na ArbiShield → stake (Saldo Reembolso) + destrava
 *   - Ganhou na Exchange   → 0 (não credita Reembolso; cobra só a dedução; destrava sem devolver)
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
 * Marker: settle-exchange-nunca-reembolso-v1 · stake-lock-v1
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
 * fee_upfront / dedução sobre odd BACK efetiva.
 * amountCents = cobertura (LAY=responsabilidade · BACK=stake).
 */
export function calcFeeUpfront(amountCents, odd) {
  const coverage =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const grossReturnCents = Math.round(coverage * o);
  const grossProfitCents = Math.max(0, grossReturnCents - coverage);
  const userProfitCents = Math.round(coverage * 0.015);
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
    billing_model: "stake_lock_v1",
  };
}

export function layToBackOdd(layOdd) {
  const o = Number.isFinite(layOdd) && layOdd > 1.01 ? layOdd : 1.01;
  return o / (o - 1);
}

/** LAY: amountCents = responsabilidade. */
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
