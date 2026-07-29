/**
 * Matemática do ciclo Desafio / Sinais — espelho browser/Node (sem ESM).
 * Manter alinhado com src/lib/arbishield/desafio-ciclo-math.ts
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ArbiDesafioCiclo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function clampFee(pct) {
    var x = Number(pct);
    if (!isFinite(x) || x < 0) return 0;
    return Math.min(100, x) / 100;
  }

  function effectiveL(odd, commissionPct) {
    var o = Number(odd);
    if (!(o > 1)) return NaN;
    var fee = clampFee(commissionPct);
    return 1 + (o - 1) * (1 - fee);
  }

  function oddFromL(L, commissionPct) {
    var fee = clampFee(commissionPct);
    if (!(L > 1) || fee >= 1) return NaN;
    return 1 + (L - 1) / (1 - fee);
  }

  function calcZebraOddFromFavorite(
    casaOdd,
    targetProfitPct,
    casaCommissionPct,
    arbiCommissionPct
  ) {
    if (targetProfitPct == null) targetProfitPct = 5;
    if (casaCommissionPct == null) casaCommissionPct = 0;
    if (arbiCommissionPct == null) arbiCommissionPct = 0;
    var Lc = effectiveL(casaOdd, casaCommissionPct);
    var margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
    if (!(Lc > margin)) {
      var err = new Error(
        "Odd do favorito (" +
          casaOdd +
          ") baixa demais para lucro de " +
          targetProfitPct +
          "%. Use odd > " +
          margin.toFixed(2) +
          "."
      );
      err.code = "FAVORITE_ODD_TOO_LOW";
      throw err;
    }
    var Lz = (margin * Lc) / (Lc - margin);
    var zebraOdd = oddFromL(Lz, arbiCommissionPct);
    if (!(zebraOdd > 1)) throw new Error("Não foi possível calcular a odd da zebra");
    return Math.round(zebraOdd * 100) / 100;
  }

  function calcCasaStakeFromZebra(
    zebraStakeCents,
    arbiOdd,
    casaOdd,
    arbiCommissionPct,
    casaCommissionPct
  ) {
    if (arbiCommissionPct == null) arbiCommissionPct = 0;
    if (casaCommissionPct == null) casaCommissionPct = 0;
    var Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
    var Lz = effectiveL(arbiOdd, arbiCommissionPct);
    var Lc = effectiveL(casaOdd, casaCommissionPct);
    if (!(Sz > 0) || !(Lz > 1) || !(Lc > 1)) return 0;
    return Math.round((Sz * Lz) / Lc);
  }

  function calcZebraPayoutCents(zebraStakeCents, arbiOdd, arbiCommissionPct) {
    if (arbiCommissionPct == null) arbiCommissionPct = 0;
    var Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
    var Lz = effectiveL(arbiOdd, arbiCommissionPct);
    if (!(Sz > 0) || !(Lz > 1)) return 0;
    return Math.round(Sz * Lz);
  }

  function calcProjectedReturnCents(zebraStakeCents, casaStakeCents, targetProfitPct) {
    if (targetProfitPct == null) targetProfitPct = 5;
    var total =
      Math.max(0, Math.round(Number(zebraStakeCents) || 0)) +
      Math.max(0, Math.round(Number(casaStakeCents) || 0));
    var margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
    return Math.round(total * margin);
  }

  function buildSinalPreview(opts) {
    opts = opts || {};
    var Sz = Math.max(0, Math.round(Number(opts.zebraStakeCents) || 0));
    var Sc = calcCasaStakeFromZebra(
      Sz,
      opts.arbiOdd,
      opts.casaOdd,
      opts.arbiCommissionPct || 0,
      opts.casaCommissionPct || 0
    );
    var payout = calcZebraPayoutCents(Sz, opts.arbiOdd, opts.arbiCommissionPct || 0);
    var pct = Number(opts.targetProfitPct) || 5;
    return {
      zebraStakeCents: Sz,
      casaStakeCents: Sc,
      zebraPayoutCents: payout,
      zebraProfitCents: Math.max(0, payout - Sz),
      projectedReturnCents: calcProjectedReturnCents(Sz, Sc, pct),
      targetProfitPct: pct,
    };
  }

  return {
    effectiveL: effectiveL,
    calcZebraOddFromFavorite: calcZebraOddFromFavorite,
    calcCasaStakeFromZebra: calcCasaStakeFromZebra,
    calcZebraPayoutCents: calcZebraPayoutCents,
    calcProjectedReturnCents: calcProjectedReturnCents,
    buildSinalPreview: buildSinalPreview,
  };
});
