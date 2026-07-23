/**
 * Matemática do ciclo Desafio / Sinais (Wilson):
 * - Admin informa odd do Favorito (casa externa)
 * - Sistema calcula odd da Zebra (ArbiShield) para lucro alvo (padrão 5%)
 * - Stake na casa = stakeZebra * L(zebra) / L(favorito)
 *
 * Uso: Node (shim/prelive) e browser (admin/app).
 */

function desafioClampFee(pct) {
  const x = Number(pct);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.min(100, x) / 100;
}

/** Multiplicador efetivo de retorno (stake incluso): 1 + (odd-1)*(1-fee) */
function desafioEffectiveL(odd, commissionPct) {
  const o = Number(odd);
  if (!(o > 1)) return NaN;
  const fee = desafioClampFee(commissionPct);
  return 1 + (o - 1) * (1 - fee);
}

/** Odd decimal a partir de L efetivo */
function desafioOddFromL(L, commissionPct) {
  const fee = desafioClampFee(commissionPct);
  if (!(L > 1) || fee >= 1) return NaN;
  return 1 + (L - 1) / (1 - fee);
}

/**
 * Odd da Zebra (ArbiShield) a partir da odd do Favorito (casa),
 * de forma que o lucro surebet ≈ targetProfitPct do volume total.
 */
function calcZebraOddFromFavorite(
  casaOdd,
  targetProfitPct = 5,
  casaCommissionPct = 0,
  arbiCommissionPct = 0
) {
  const Lc = desafioEffectiveL(casaOdd, casaCommissionPct);
  const margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
  if (!(Lc > margin)) {
    const err = new Error(
      `Odd do favorito (${casaOdd}) baixa demais para lucro de ${targetProfitPct}%. Use odd > ${margin.toFixed(2)}.`
    );
    err.code = "FAVORITE_ODD_TOO_LOW";
    throw err;
  }
  const Lz = (margin * Lc) / (Lc - margin);
  const zebraOdd = desafioOddFromL(Lz, arbiCommissionPct);
  if (!(zebraOdd > 1)) {
    throw new Error("Não foi possível calcular a odd da zebra");
  }
  return Math.round(zebraOdd * 100) / 100;
}

/** Stake na casa externa para equalizar retorno com a zebra */
function calcCasaStakeFromZebra(
  zebraStakeCents,
  arbiOdd,
  casaOdd,
  arbiCommissionPct = 0,
  casaCommissionPct = 0
) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  const Lz = desafioEffectiveL(arbiOdd, arbiCommissionPct);
  const Lc = desafioEffectiveL(casaOdd, casaCommissionPct);
  if (!(Sz > 0) || !(Lz > 1) || !(Lc > 1)) return 0;
  return Math.round((Sz * Lz) / Lc);
}

/** Retorno projetado (payout) se a zebra bater */
function calcZebraPayoutCents(zebraStakeCents, arbiOdd, arbiCommissionPct = 0) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  const Lz = desafioEffectiveL(arbiOdd, arbiCommissionPct);
  if (!(Sz > 0) || !(Lz > 1)) return 0;
  return Math.round(Sz * Lz);
}

/** Lucro líquido (payout − stake) na zebra */
function calcZebraProfitCents(zebraStakeCents, arbiOdd, arbiCommissionPct = 0) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  return Math.max(0, calcZebraPayoutCents(Sz, arbiOdd, arbiCommissionPct) - Sz);
}

/** Retorno projetado do ciclo (= volume * (1 + target%)) ≈ payout equalizado */
function calcProjectedReturnCents(zebraStakeCents, casaStakeCents, targetProfitPct = 5) {
  const total =
    Math.max(0, Math.round(Number(zebraStakeCents) || 0)) +
    Math.max(0, Math.round(Number(casaStakeCents) || 0));
  const margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
  return Math.round(total * margin);
}

function buildSinalPreview({
  zebraStakeCents,
  arbiOdd,
  casaOdd,
  arbiCommissionPct = 0,
  casaCommissionPct = 0,
  targetProfitPct = 5,
}) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  const Sc = calcCasaStakeFromZebra(
    Sz,
    arbiOdd,
    casaOdd,
    arbiCommissionPct,
    casaCommissionPct
  );
  const payoutZebra = calcZebraPayoutCents(Sz, arbiOdd, arbiCommissionPct);
  const projected = calcProjectedReturnCents(Sz, Sc, targetProfitPct);
  return {
    zebraStakeCents: Sz,
    casaStakeCents: Sc,
    zebraPayoutCents: payoutZebra,
    zebraProfitCents: Math.max(0, payoutZebra - Sz),
    projectedReturnCents: projected,
    targetProfitPct: Number(targetProfitPct) || 5,
  };
}

export {
  desafioEffectiveL,
  desafioOddFromL,
  calcZebraOddFromFavorite,
  calcCasaStakeFromZebra,
  calcZebraPayoutCents,
  calcZebraProfitCents,
  calcProjectedReturnCents,
  buildSinalPreview,
};
