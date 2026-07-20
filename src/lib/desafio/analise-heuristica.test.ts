import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analisarHeuristica } from "./analise-heuristica";
import type { JogoDesafio } from "./types";

function base(overrides: Partial<JogoDesafio> = {}): JogoDesafio {
  return {
    id: "t1",
    liga: "Teste",
    casa: "A",
    fora: "B",
    inicioEm: new Date(Date.now() + 20 * 60_000).toISOString(),
    mercado: "Over/Under 2.5",
    selecao: "Over 2.5",
    odd: 1.7,
    bookmaker: "BetBra",
    mediaGolsCasa: 1.7,
    mediaGolsFora: 1.5,
    mediaGolsSofridosCasa: 1.2,
    mediaGolsSofridosFora: 1.4,
    bttsPct: 60,
    surebetSpread: 1.5,
    ...overrides,
  };
}

describe("analisarHeuristica", () => {
  it("aprova jogo dentro dos critérios do Desafio", () => {
    const a = analisarHeuristica(base());
    assert.equal(a.encaixaCriterios.faixaOdd, true);
    assert.equal(a.encaixaCriterios.janelaPreLive, true);
    assert.ok(a.confianca >= 70);
    assert.equal(a.veredito, "entrar");
  });

  it("marca odd fora da faixa", () => {
    const a = analisarHeuristica(base({ odd: 2.1 }));
    assert.equal(a.encaixaCriterios.faixaOdd, false);
    assert.notEqual(a.veredito, "entrar");
  });
});
