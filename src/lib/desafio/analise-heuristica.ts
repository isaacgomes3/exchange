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
 * Lista: próximas 24h. Lançamento: só nos últimos 30 min.
 */
export function analisarHeuristica(jogo: JogoDesafio): AnaliseDesafio {
  const minutos = minutosAteKickoff(jogo.inicioEm);
  const maxLancamento = DESAFIO_CRITERIOS.janelaLancamentoMin;
  const faixaOdd =
    jogo.odd >= DESAFIO_CRITERIOS.oddMin && jogo.odd <= DESAFIO_CRITERIOS.oddMax;
  const podeLancar = minutos > 0 && minutos <= maxLancamento;
  const minutosParaLiberar = podeLancar
    ? 0
    : Math.max(0, Math.round(minutos - maxLancamento));
  const mercadoOk = jogo.mercado === DESAFIO_CRITERIOS.mercado;
  const esperados = mediaEsperadaGols(jogo);

  let score = 45;
  const riscos: string[] = [];

  if (mercadoOk) score += 10;
  if (faixaOdd) score += 18;
  else {
    score -= 12;
    riscos.push(`Odd ${jogo.odd.toFixed(2)} fora da faixa 1.60–1.80`);
  }

  if (podeLancar) score += 15;
  else if (minutos > 0) {
    // Ainda na lista 24h — não descartar; só ainda não libera lançamento
    score += 4;
    riscos.push(
      `Na lista 24h; lançamento libera em ~${minutosParaLiberar} min (janela ≤${maxLancamento} min)`
    );
  } else {
    score -= 20;
    riscos.push("Jogo já iniciado ou kickoff inválido");
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
  if (confianca >= 70 && faixaOdd && podeLancar) veredito = "entrar";
  else if (confianca < 45 || minutos <= 0) veredito = "descartar";

  const tese =
    veredito === "entrar"
      ? `${jogo.casa} x ${jogo.fora}: liberado para lançar (${jogo.selecao} @ ${jogo.odd.toFixed(2)}, ~${Math.round(minutos)} min).`
      : veredito === "descartar"
        ? `${jogo.casa} x ${jogo.fora}: fora do perfil — ${riscos[0] ?? "critérios fracos"}.`
        : podeLancar
          ? `${jogo.casa} x ${jogo.fora}: na janela de lançamento; perfil misto para ${jogo.selecao}.`
          : `${jogo.casa} x ${jogo.fora}: na lista 24h; só libera lançamento nos últimos ${maxLancamento} min.`;

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
      janelaPreLive: podeLancar,
    },
    podeLancar,
    minutosParaLiberar,
    fonte: "heuristica",
  };
}

export function analisarLoteHeuristica(jogos: JogoDesafio[]): AnaliseDesafio[] {
  return jogos.map(analisarHeuristica);
}
