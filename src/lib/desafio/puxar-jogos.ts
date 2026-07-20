import type { JogoDesafio } from "./types";

/**
 * Simula o "puxar jogos" da área Desafio (Arbishield / pré-live).
 * Troque por chamada real à API de surebets quando integrar o backend.
 */
export async function puxarJogosDesafio(): Promise<JogoDesafio[]> {
  const agora = Date.now();
  const emMin = (m: number) => new Date(agora + m * 60_000).toISOString();

  return [
    {
      id: "arb-1001",
      liga: "Brasil - Série B",
      casa: "Sport Recife",
      fora: "Criciúma",
      inicioEm: emMin(22),
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.72,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.6,
      mediaGolsFora: 1.3,
      mediaGolsSofridosCasa: 1.1,
      mediaGolsSofridosFora: 1.4,
      bttsPct: 58,
      surebetSpread: 1.8,
    },
    {
      id: "arb-1002",
      liga: "Argentina - Primera",
      casa: "Racing",
      fora: "Lanús",
      inicioEm: emMin(28),
      mercado: "Over/Under 2.5",
      selecao: "Under 2.5",
      odd: 1.65,
      bookmaker: "BetBra",
      mediaGolsCasa: 0.9,
      mediaGolsFora: 0.8,
      mediaGolsSofridosCasa: 0.7,
      mediaGolsSofridosFora: 0.9,
      bttsPct: 34,
      surebetSpread: 2.1,
    },
    {
      id: "arb-1003",
      liga: "Europa - Amistoso",
      casa: "Time Alpha",
      fora: "Time Beta",
      inicioEm: emMin(45),
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.95,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.2,
      mediaGolsFora: 1.1,
      mediaGolsSofridosCasa: 1.0,
      mediaGolsSofridosFora: 1.2,
      bttsPct: 48,
      surebetSpread: 0.4,
    },
    {
      id: "arb-1004",
      liga: "Portugal - Liga 2",
      casa: "Feirense",
      fora: "Mafra",
      inicioEm: emMin(18),
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.78,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.8,
      mediaGolsFora: 1.5,
      mediaGolsSofridosCasa: 1.3,
      mediaGolsSofridosFora: 1.6,
      bttsPct: 62,
      surebetSpread: 1.5,
    },
  ];
}
