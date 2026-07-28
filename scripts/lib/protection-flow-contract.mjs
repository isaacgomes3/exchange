/**
 * ============================================================================
 * CONTRATO TRAVADO — Fluxo de Proteção ArbiShield (locked_margin_v2)
 * ============================================================================
 * NÃO ALTERAR sem solicitação explícita do dono do produto.
 * Qualquer mudança aqui ou nos callers (prelive/shim/create-protection/UI)
 * deve ser pedida pelo usuário. Este módulo é a fonte da verdade das regras
 * de crédito no settle; os testes em protection-flow-contract.test.mjs
 * travam o comportamento no CI.
 *
 * Versão: protection-flow-contract-v4 (2026-07-28)
 *   + stake/responsabilidade bloqueada; margem cobrada só no Exchange
 * ============================================================================
 */

export const PROTECTION_FLOW_CONTRACT_VERSION =
  "protection-flow-contract-v4";

/** Marcador exigido pelos testes / hotfixes — não renomear. */
export const PROTECTION_FLOW_LOCK =
  "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST";

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
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

export function isFeeUpfrontProtection(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  );
}

/** Novo fluxo: a stake/responsabilidade inteira foi debitada e bloqueada. */
export function isLockedMarginProtection(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return (
    meta.billing_model === "locked_margin_v2" ||
    meta.locked_margin === true ||
    String(meta.source || "").includes("locked_margin")
  );
}

/**
 * Margem retida pela Exchange no novo fluxo, dedução fee_upfront ou margem legada.
 */
export function settlementDeductionCents(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const raw =
    row?.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row?.platform_profit_cents != null
        ? row.platform_profit_cents
        : meta.margin_cents != null
          ? meta.margin_cents
        : meta.fee_charged_cents != null
          ? meta.fee_charged_cents
          : row?.locked_deduction_cents;
  let fee = Math.max(0, n(raw));
  if (!(fee > 0) && (isFeeUpfrontProtection(row) || isLockedMarginProtection(row))) {
    const stake = n(
      row?.responsibility_cents || row?.amount_cents || meta.stake_cents
    );
    // Preferir odd do mercado lançado (metadata.market_odd); senão coluna odd.
    let odd = Number(meta.market_odd);
    if (!(odd > 1.01)) odd = Number(row?.odd || 0);
    const mt = String(meta.market_type || "").toUpperCase();
    if (mt === "LAY" && odd > 1.01) odd = odd / (odd - 1);
    if (stake > 0 && odd > 1.01) {
      const profit = Math.max(0, Math.round(stake * odd) - stake);
      fee = isLockedMarginProtection(row)
        ? Math.round(stake * 0.015) + Math.round(profit * 0.045)
        : Math.max(0, profit - Math.round(stake * 0.015));
    }
  }
  return fee;
}

/**
 * Regras de crédito no settle (TRAVADAS):
 *
 * locked_margin_v2:
 *   - ArbiShield → destrava 100% ao Saldo Apostador e paga 100% no Saldo Reembolso
 *   - Exchange   → stake − margem para Saldo Apostador; margem é retida
 *   - Empate Anula / void → 100% da stake para Saldo Apostador
 *
 * fee_upfront_v1 (compatibilidade):
 *   - ArbiShield → somente stake/responsabilidade
 *   - Exchange   → 0 (dedução permanece na plataforma)
 *   - Empate Anula / void → só a dedução (aposta anulada)
 *
 * legado (lock):
 *   - ArbiShield → stake inteiro
 *   - Exchange   → stake − taxa
 *   - Empate Anula / void → stake inteiro (libera lock)
 *
 * Cancelamento (fora daqui): estorna só a dedução no fee_upfront.
 */
export function settlementCreditParts(row, outcome) {
  const amount = n(row?.responsibility_cents || row?.amount_cents);
  const fee = settlementDeductionCents(row);
  const o = normalizeSettleOutcome(outcome);
  const wonArbi = o === "arbishield";
  const isVoid = o === "void";
  if (isLockedMarginProtection(row)) {
    if (isVoid || wonArbi) return { stake: amount, fee: 0, total: amount };
    const keep = Math.min(fee, amount);
    return { stake: Math.max(0, amount - keep), fee: keep, total: Math.max(0, amount - keep) };
  }
  if (isFeeUpfrontProtection(row)) {
    if (isVoid) return { stake: 0, fee, total: fee };
    if (!wonArbi) return { stake: 0, fee: 0, total: 0 };
    return { stake: amount, fee: 0, total: amount };
  }
  if (isVoid || wonArbi) return { stake: amount, fee: 0, total: amount };
  const keep = Math.min(fee, amount);
  const net = Math.max(0, amount - keep);
  return { stake: net, fee: 0, total: net };
}

export function settlementCreditCents(row, outcome) {
  return settlementCreditParts(row, outcome).total;
}

/**
 * Compatibilidade: bucket padrão do fluxo anterior.
 */
export function creditBucketForSettlement(_balanceType) {
  return "deduction_balance_cents";
}

/** Bucket explícito do novo fluxo. */
export function settlementCreditBucket(row, outcome) {
  if (isLockedMarginProtection(row)) return "balance_cents";
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
 * Margem registrada sobre odd BACK efetiva.
 * amountCents = cobertura (LAY=responsabilidade · BACK=stake).
 */
export function calcFeeUpfront(amountCents, odd) {
  const coverage =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const grossReturnCents = Math.round(coverage * o);
  const grossProfitCents = Math.max(0, grossReturnCents - coverage);
  const userProfitCents = Math.round(coverage * 0.015);
  const grossProfitMarginCents = Math.round(grossProfitCents * 0.045);
  const marginCents = userProfitCents + grossProfitMarginCents;
  return {
    stakeCents: coverage,
    responsibilityCents: coverage,
    coverageCents: coverage,
    odd: o,
    effectiveBackOdd: o,
    grossReturnCents,
    grossProfitCents,
    userProfitCents,
    grossProfitMarginCents,
    marginCents,
    // Nome preservado para callers legados; neste modelo a margem não é cobrada
    // na criação.
    arbiShieldDeductionCents: marginCents,
    billing_model: "locked_margin_v2",
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
    // Persistência/UI: odd LAY do mercado (não a back equivalente).
    // A conversão L/(L−1) fica só em effectiveBackOdd p/ cálculo de fee.
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
