/**
 * Fluxo oficial de proteção ArbiShield — FLUXO_PROTECAO_V1
 *
 * Spec (uma operação de carteira por liquidação — NÃO destrava + devolve em dobro):
 *   Proteger         → Apostador −R · Congelado +R · protection_lock
 *   Reembolso        → Congelado −R · Apostador +R (100%)   [API: arbishield]
 *   Venceu Exchange  → Congelado −R · Apostador +(R−taxa)   [API: exchange]
 *                      taxa = 4,5% no lucro + 1,5% do stake
 *
 * “Destravar” = mover Congelado → Apostador no mesmo PATCH (não são 2 créditos).
 */

export const PROTECTION_FLOW_VERSION = "fluxo-protecao-v1";

/** @param {number} amountCents responsabilidade LAY */
export function calcLay(amountCents, odd, lockRatio = 0.9073) {
  const responsibilityCents =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const ratio =
    Number.isFinite(lockRatio) && lockRatio >= 0 && lockRatio <= 1
      ? lockRatio
      : 0.9073;
  const stakeRealCents = Math.round(responsibilityCents / (o - 1));
  const lockedDeductionCents = Math.round(stakeRealCents * ratio);
  const exchangeProfitGrossCents = stakeRealCents;
  const exchangeFeeCents = Math.round(exchangeProfitGrossCents * 0.045);
  const exchangeProfitNetCents = exchangeProfitGrossCents - exchangeFeeCents;
  const userProfitCents = Math.round(responsibilityCents * 0.015);
  const arbiShieldDeductionCents = exchangeProfitNetCents - userProfitCents;
  return {
    responsibilityCents,
    odd: o,
    stakeRealCents,
    lockedDeductionCents,
    exchangeFeeCents,
    exchangeProfitNetCents,
    userProfitCents,
    arbiShieldDeductionCents,
    /** margem cobrada só se bater Exchange */
    platformDeductionCents: arbiShieldDeductionCents,
  };
}

/** @param {number} amountCents cobertura BACK */
export function calcBack(amountCents, odd) {
  const coverage =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd >= 1.01 ? odd : 1.01;
  const grossReturnCents = Math.round(coverage * o);
  const grossProfitCents = Math.max(0, grossReturnCents - coverage);
  const exchangeFeeCents = Math.round(grossProfitCents * 0.045);
  const netProfitExchangeCents = grossProfitCents - exchangeFeeCents;
  const userProfitCents = Math.round(coverage * 0.015);
  const arbiShieldDeductionCents = netProfitExchangeCents - userProfitCents;
  return {
    coverageCents: coverage,
    odd: o,
    grossReturnCents,
    grossProfitCents,
    exchangeFeeCents,
    netProfitExchangeCents,
    userProfitCents,
    arbiShieldDeductionCents,
    platformDeductionCents: arbiShieldDeductionCents,
  };
}

function nCents(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : 0;
}

export function settlementDeductionCents(row) {
  const raw =
    row?.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row?.locked_deduction_cents;
  return Math.max(0, nCents(raw));
}

/**
 * @param {object} row protection row
 * @param {"arbishield"|"exchange"} outcome
 */
export function settlementCreditCents(row, outcome) {
  const amount = nCents(row?.responsibility_cents || row?.amount_cents);
  if (amount <= 0) return 0;
  if (String(outcome).toLowerCase() === "arbishield") return amount;
  const fee = Math.min(settlementDeductionCents(row), amount);
  return Math.max(0, amount - fee);
}

export function settlementStatusForOutcome(outcome) {
  return String(outcome).toLowerCase() === "arbishield"
    ? "lost_exchange"
    : "won_exchange";
}

/** Exemplo do spec: R$ 500 LAY @ 1.10 */
export function exampleLay500at110() {
  const c = calcLay(50000, 1.1);
  return {
    R: 50000,
    margem: c.platformDeductionCents,
    creditArbi: settlementCreditCents(
      { amount_cents: 50000, platform_deduction_cents: c.platformDeductionCents },
      "arbishield"
    ),
    creditExchange: settlementCreditCents(
      { amount_cents: 50000, platform_deduction_cents: c.platformDeductionCents },
      "exchange"
    ),
  };
}
