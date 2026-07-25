/**
 * ============================================================================
 * CONTRATO TRAVADO — Fluxo de Proteção ArbiShield (fee_upfront_v1)
 * ============================================================================
 * NÃO ALTERAR sem solicitação explícita do dono do produto.
 * Qualquer mudança aqui ou nos callers (prelive/shim/create-protection/UI)
 * deve ser pedida pelo usuário. Este módulo é a fonte da verdade das regras
 * de crédito no settle; os testes em protection-flow-contract.test.mjs
 * travam o comportamento no CI.
 *
 * Versão: protection-flow-contract-v1 (2026-07-25)
 * ============================================================================
 */

export const PROTECTION_FLOW_CONTRACT_VERSION =
  "protection-flow-contract-v1";

/** Marcador exigido pelos testes / hotfixes — não renomear. */
export const PROTECTION_FLOW_LOCK =
  "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST";

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
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

/**
 * Dedução ArbiShield cobrada na ativação (fee_upfront) ou margem legada.
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
  if (!(fee > 0) && isFeeUpfrontProtection(row)) {
    const stake = n(
      row?.responsibility_cents || row?.amount_cents || meta.stake_cents
    );
    let odd = Number(row?.odd || meta.market_odd || 0);
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
 * fee_upfront_v1:
 *   - ArbiShield → stake/responsabilidade + dedução (total)
 *   - Exchange   → 0 (dedução permanece na plataforma)
 *
 * legado (lock):
 *   - ArbiShield → stake inteiro
 *   - Exchange   → stake − taxa
 *
 * Cancelamento (fora daqui): estorna só a dedução no fee_upfront.
 */
export function settlementCreditParts(row, outcome) {
  const amount = n(row?.responsibility_cents || row?.amount_cents);
  const fee = settlementDeductionCents(row);
  const wonArbi = String(outcome || "").toLowerCase() === "arbishield";
  if (isFeeUpfrontProtection(row)) {
    if (!wonArbi) return { stake: 0, fee: 0, total: 0 };
    return { stake: amount, fee, total: amount + fee };
  }
  if (wonArbi) return { stake: amount, fee: 0, total: amount };
  const keep = Math.min(fee, amount);
  const net = Math.max(0, amount - keep);
  return { stake: net, fee: 0, total: net };
}

export function settlementCreditCents(row, outcome) {
  return settlementCreditParts(row, outcome).total;
}

/**
 * Bucket de crédito após settle ArbiShield:
 *   DEMO     → demo_balance_cents
 *   INVESTOR → investor_balance_cents
 *   REAL     → deduction_balance_cents (UI: Saldo Reembolso — usável + sacável)
 */
export function creditBucketForSettlement(balanceType) {
  const t = String(balanceType || "REAL").toUpperCase();
  if (t === "DEMO") return "demo_balance_cents";
  if (t === "INVESTOR") return "investor_balance_cents";
  return "deduction_balance_cents";
}

/** Status persistido na proteção conforme outcome. */
export function settlementStatusForOutcome(outcome) {
  return String(outcome || "").toLowerCase() === "arbishield"
    ? "lost_exchange"
    : "won_exchange";
}

/**
 * fee_upfront sobre odd BACK efetiva.
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
    billing_model: "fee_upfront_v1",
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
