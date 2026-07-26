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
 * Versão: protection-flow-contract-v4 (2026-07-26)
 *   + lock_fee_after_v1 settle revisado (pedido explícito):
 *       ativação trava stake/responsabilidade (sem dedução);
 *       Bateu Exchange → cobra dedução (REAL/DEMO) e libera stake à origem;
 *       Bateu ArbiShield → libera stake → Saldo Reembolso (sem dedução);
 *       Empate Anula → libera stake; Cancelar → devolve travado
 *   (v3) lock_fee_after inicial
 *   (v2) Empate Anula / void → devolve só a dedução (fee_upfront)
 * ============================================================================
 */

export const PROTECTION_FLOW_CONTRACT_VERSION =
  "protection-flow-contract-v4";

/** Marcador exigido pelos testes / hotfixes — não renomear. */
export const PROTECTION_FLOW_LOCK =
  "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST";

/** Modelo padrão para NOVAS proteções. */
export const PROTECTION_BILLING_MODEL_DEFAULT = "lock_fee_after_v1";

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
  // lock_fee_after tem precedência se marcado explicitamente
  if (isLockFeeAfterProtection(row)) return false;
  return (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  );
}

/**
 * Modelo padrão (v4): stake/responsabilidade travado na ativação;
 * dedução cobrada só se Bateu Exchange.
 */
export function isLockFeeAfterProtection(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return (
    meta.billing_model === "lock_fee_after_v1" ||
    meta.lock_fee_after === true ||
    meta.stake_locked === true ||
    String(meta.source || "").includes("lock_fee_after")
  );
}

/**
 * Dedução ArbiShield (= lucro bruto − 1,5% da cobertura).
 * Em lock_fee_after ainda não foi cobrada na ativação (fee_pending).
 */
export function settlementDeductionCents(row) {
  const meta =
    row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const raw =
    row?.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row?.platform_profit_cents != null
        ? row.platform_profit_cents
        : meta.fee_pending_cents != null
          ? meta.fee_pending_cents
          : meta.fee_charged_cents != null
            ? meta.fee_charged_cents
            : row?.locked_deduction_cents;
  let fee = Math.max(0, n(raw));
  if (!(fee > 0) && (isFeeUpfrontProtection(row) || isLockFeeAfterProtection(row))) {
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
      const userProfit = Math.round(stake * 0.015);
      fee = Math.max(0, profit - userProfit);
    }
  }
  return fee;
}

/**
 * Regras de crédito no settle (TRAVADAS):
 *
 * lock_fee_after_v1 (padrão novo):
 *   - Ativação → trava stake/responsabilidade (sem dedução)
 *   - Bateu Exchange → libera stake à carteira de origem + cobra dedução (REAL/DEMO)
 *   - Bateu ArbiShield → libera stake → Saldo Reembolso (sem dedução)
 *   - Empate Anula / void → libera stake à carteira de origem (sem dedução)
 *   - Cancelar → devolve stake travado à origem
 *
 * fee_upfront_v1 (proteções antigas):
 *   - ArbiShield → stake/responsabilidade + dedução (total)
 *   - Exchange   → 0 (dedução permanece na plataforma)
 *   - Empate Anula / void → só a dedução (aposta anulada)
 *
 * legado (lock):
 *   - ArbiShield → stake inteiro
 *   - Exchange   → stake − taxa
 *   - Empate Anula / void → stake inteiro (libera lock)
 */
export function settlementCreditParts(row, outcome) {
  const amount = n(row?.responsibility_cents || row?.amount_cents);
  const fee = settlementDeductionCents(row);
  const o = normalizeSettleOutcome(outcome);
  const wonArbi = o === "arbishield";
  const isVoid = o === "void";

  if (isLockFeeAfterProtection(row)) {
    // Sempre libera o stake travado. Dedução (se houver) é cobrada fora, só no Exchange.
    return { stake: amount, fee: 0, total: amount };
  }

  if (isFeeUpfrontProtection(row)) {
    if (isVoid) return { stake: 0, fee, total: fee };
    if (!wonArbi) return { stake: 0, fee: 0, total: 0 };
    return { stake: amount, fee, total: amount + fee };
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
 * Destino do crédito ao liberar stake (lock_fee_after):
 * - ArbiShield → Saldo Reembolso
 * - Exchange / Empate Anula / demais → carteira de origem (REAL/DEMO/INVESTOR)
 *
 * fee_upfront / legado: sempre Saldo Reembolso (comportamento anterior).
 */
export function settlementCreditDestination(row, outcome, balanceType) {
  const o = normalizeSettleOutcome(outcome);
  if (isLockFeeAfterProtection(row)) {
    if (o === "arbishield") return "deduction_balance_cents";
    const bt = String(balanceType || "REAL").toUpperCase();
    if (bt === "DEMO") return "demo_balance_cents";
    if (bt === "INVESTOR") return "investor_balance_cents";
    return "balance_cents";
  }
  return creditBucketForSettlement(balanceType);
}

/** lock_fee_after: dedução só é cobrada quando Bateu Exchange. */
export function shouldChargeFeeAfterResult(row, outcome) {
  if (!isLockFeeAfterProtection(row)) return false;
  return normalizeSettleOutcome(outcome) === "exchange";
}

/**
 * Bucket padrão (fee_upfront / legado / ArbiShield lock_fee_after):
 * `deduction_balance_cents` = UI **Saldo Reembolso**.
 */
export function creditBucketForSettlement(_balanceType) {
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
 * fee_upfront / lock_fee_after — cálculo da dedução sobre odd BACK efetiva.
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
    billing_model: PROTECTION_BILLING_MODEL_DEFAULT,
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
