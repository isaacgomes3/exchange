import { DESAFIO_CRITERIOS, type AnaliseDesafio, type JogoDesafio } from "./types";

function minutosAteKickoff(inicioEm: string, agora = Date.now()): number {
  return (new Date(inicioEm).getTime() - agora) / 60_000;
}

function mediaEsperadaGols(jogo: JogoDesafio): number {
  return (
    (jogo.mediaGolsCasa +
      jogo.mediaGolsFora +
      jogo.mediaGolsSofridosCasa +
      jogo.mediaGolsSofridosFora) /
    2
  );
}

/**
 * Analisador local — usado sem API key e como fallback.
 * Avalia encaixe nos critérios do Desafio + perfil de gols.
 */
export function analisarHeuristica(jogo: JogoDesafio): AnaliseDesafio {
  const minutos = minutosAteKickoff(jogo.inicioEm);
  const faixaOdd =
    jogo.odd >= DESAFIO_CRITERIOS.oddMin && jogo.odd <= DESAFIO_CRITERIOS.oddMax;
  const janelaPreLive = minutos > 0 && minutos <= 30;
  const mercadoOk = jogo.mercado === DESAFIO_CRITERIOS.mercado;
  const esperados = mediaEsperadaGols(jogo);

  let score = 40;
  const riscos: string[] = [];

  if (mercadoOk) score += 10;
  if (faixaOdd) score += 18;
  else {
    score -= 12;
    riscos.push(`Odd ${jogo.odd.toFixed(2)} fora da faixa 1.60–1.80`);
  }

  if (janelaPreLive) score += 15;
  else {
    score -= 10;
    riscos.push(
      minutos <= 0
        ? "Jogo já iniciado ou kickoff inválido"
        : `Fora da janela pré-live 30 min (~${Math.round(minutos)} min)`
    );
  }

  if (jogo.selecao === "Over 2.5") {
    if (esperados >= 2.7) score += 14;
    else if (esperados >= 2.4) score += 8;
    else {
      score -= 8;
      riscos.push("Média de gols fraca para Over 2.5");
    }
    if (jogo.bttsPct >= 55) score += 6;
  } else {
    if (esperados <= 2.2) score += 14;
    else if (esperados <= 2.5) score += 6;
    else {
      score -= 8;
      riscos.push("Média de gols alta para Under 2.5");
    }
    if (jogo.bttsPct <= 40) score += 6;
  }

  if ((jogo.surebetSpread ?? 0) >= 1) score += 5;
  else riscos.push("Spread de surebet baixo / frágil");

  const confianca = Math.max(0, Math.min(100, Math.round(score)));
  let veredito: AnaliseDesafio["veredito"] = "observar";
  if (confianca >= 70 && faixaOdd && janelaPreLive) veredito = "entrar";
  else if (confianca < 50) veredito = "descartar";

  const tese =
    veredito === "entrar"
      ? `${jogo.casa} x ${jogo.fora}: ${jogo.selecao} encaixa no Desafio (odd ${jogo.odd.toFixed(2)}, ~${Math.round(minutos)} min). Expectativa ~${esperados.toFixed(1)} gols.`
      : veredito === "descartar"
        ? `${jogo.casa} x ${jogo.fora}: fora do perfil do Desafio — ${riscos[0] ?? "critérios fracos"}.`
        : `${jogo.casa} x ${jogo.fora}: perfil misto para ${jogo.selecao}; monitorar movimento de odd na janela pré-live.`;

  if (riscos.length === 0) riscos.push("Movimento de linha nos últimos minutos");

  return {
    jogoId: jogo.id,
    aprovado: veredito === "entrar",
    confianca,
    veredito,
    tese,
    riscos: riscos.slice(0, 3),
    encaixaCriterios: {
      mercado: mercadoOk,
      faixaOdd,
      janelaPreLive,
    },
    fonte: "heuristica",
  };
}

export function analisarLoteHeuristica(jogos: JogoDesafio[]): AnaliseDesafio[] {
  return jogos.map(analisarHeuristica);
}
