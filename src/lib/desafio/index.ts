import { analisarLoteHeuristica } from "./analise-heuristica";
import { analisarComOpenAI } from "./analise-openai";
import { puxarJogosDesafio } from "./puxar-jogos";
import { DESAFIO_CRITERIOS, type DesafioPullResult } from "./types";

/**
 * Fluxo da área Desafio:
 * 1) puxa jogos (Arbishield / pré-live)
 * 2) analisa com OpenAI (se houver chave) ou heurística local
 */
export async function puxarEAnalisarDesafio(): Promise<DesafioPullResult> {
  const jogos = await puxarJogosDesafio();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

  let analises = analisarLoteHeuristica(jogos);

  if (apiKey) {
    try {
      analises = await analisarComOpenAI(jogos, apiKey, model);
    } catch (err) {
      console.error("[desafio] OpenAI falhou, usando heurística:", err);
      analises = analisarLoteHeuristica(jogos);
    }
  }

  return {
    criterios: DESAFIO_CRITERIOS,
    jogos,
    analises,
    analisadoEm: new Date().toISOString(),
    janelaBuscaHoras: 24,
  };
}
