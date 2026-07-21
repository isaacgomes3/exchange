/**
 * Surebet helpers for ArbiShield desafios.
 *
 * Given BetBra (casa) odds and a target margin M (e.g. 0.05 = 5%):
 *   1/casa + 1/arbi = 1 - M
 *   arbi = 1 / ((1 - M) - 1/casa)
 */

export function calcArbiOddFromCasa(
  casaOdd: number,
  profitMarginPct: number
): number | null {
  if (!Number.isFinite(casaOdd) || casaOdd <= 1) return null;
  const m = profitMarginPct / 100;
  if (m < 0 || m >= 1) return null;
  const invTarget = 1 - m;
  const invCasa = 1 / casaOdd;
  if (invCasa >= invTarget) return null; // cannot build surebet at this margin
  const arbi = 1 / (invTarget - invCasa);
  if (!Number.isFinite(arbi) || arbi <= 1) return null;
  return Number(arbi.toFixed(3));
}

export function calcSurebetStakes(options: {
  casaOdd: number;
  arbiOdd: number;
  /** Capacidade/liquidez ArbiShield em centavos (ex.: 200000) */
  liquidityCents: number;
  /**
   * Nos exemplos do painel, o stake Arbi operacional ≈ liquidity/10.
   * Mantemos o mesmo padrão.
   */
  arbiStakeFactor?: number;
}): { casaStakeCents: number; arbiStakeCents: number; marginPct: number } {
  const factor = options.arbiStakeFactor ?? 0.1;
  const arbiStakeCents = Math.max(
    100,
    Math.round(options.liquidityCents * factor)
  );
  const casaStakeCents = Math.max(
    100,
    Math.round((arbiStakeCents * options.arbiOdd) / options.casaOdd)
  );
  const marginPct =
    (1 - (1 / options.casaOdd + 1 / options.arbiOdd)) * 100;
  return {
    casaStakeCents,
    arbiStakeCents,
    marginPct: Number(marginPct.toFixed(2)),
  };
}

export function isOddInRange(odd: number, min: number, max: number): boolean {
  return odd >= min && odd <= max;
}
