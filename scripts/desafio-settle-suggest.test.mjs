/**
 * Sugestão de botão para liquidar etapa (desafio-settle-suggest-v1).
 *
 * Precisa concordar com o marcador do card: Empate Anula é aposta no time, com
 * estorno no empate. Se os dois divergirem, o admin vê V/× no card e o relatório
 * manda apertar outra coisa.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SETTLE_SUGGEST_VERSION,
  marketStatus,
  marketTeamSide,
  suggestProtectionOutcome,
  suggestSettle,
} from "./lib/desafio-settle-suggest.mjs";

const FT = true;
const LIVE = false;

describe("botão sugerido", () => {
  it("versão", () => {
    assert.equal(SETTLE_SUGGEST_VERSION, "desafio-settle-suggest-v1");
  });

  it("empate em Empate Anula → estorno, nunca pagar um lado", () => {
    const s = suggestSettle({
      marketArbi: "NORRBY IF EMPATE ANULA",
      marketCasa: "ODDEVOLD EMPATE ANULA",
      home: 0,
      away: 0,
      finished: FT,
      homeTeam: "ODDEVOLD",
      awayTeam: "NORRBY",
    });
    assert.equal(s.winningSide, "empate_anula");
    assert.equal(s.label, "Empate Anula");
  });

  it("time da casa venceu → Bateu Casa", () => {
    const s = suggestSettle({
      marketArbi: "GRAZER AK EMPATE ANULA",
      marketCasa: "LASK LINZ EMPATE ANULA",
      home: 2,
      away: 0,
      finished: FT,
      homeTeam: "LASK",
      awayTeam: "GRAZER AK",
    });
    assert.equal(s.winningSide, "casa");
  });

  it("time da ArbiShield venceu → Bateu ArbiShield", () => {
    const s = suggestSettle({
      marketArbi: "ARGEȘ PITEȘTI EMPATE ANULA",
      marketCasa: "CSÍKSZEREDA EMPATE ANULA",
      home: 1,
      away: 0,
      finished: FT,
      homeTeam: "ARGEȘ PITEȘTI",
      awayTeam: "CSÍKSZEREDA MIERCUREA CIUC",
    });
    assert.equal(s.winningSide, "arbishield");
  });

  it("jogo não encerrado não sugere nada", () => {
    const s = suggestSettle({
      marketArbi: "NORRBY IF EMPATE ANULA",
      marketCasa: "ODDEVOLD EMPATE ANULA",
      home: 1,
      away: 0,
      finished: LIVE,
      homeTeam: "ODDEVOLD",
      awayTeam: "NORRBY",
    });
    assert.equal(s.winningSide, null);
    assert.equal(s.label, "aguardar");
  });

  it("sem placar não sugere nada", () => {
    const s = suggestSettle({
      marketArbi: "A EMPATE ANULA",
      marketCasa: "B EMPATE ANULA",
      home: null,
      away: null,
      finished: FT,
      homeTeam: "A",
      awayTeam: "B",
    });
    assert.equal(s.winningSide, null);
  });

  it("mercado não reconhecido manda conferir, não adivinha", () => {
    const s = suggestSettle({
      marketArbi: "Handicap asiático -1.25",
      marketCasa: "Handicap asiático +1.25",
      home: 2,
      away: 0,
      finished: FT,
      homeTeam: "A",
      awayTeam: "B",
    });
    assert.equal(s.winningSide, null);
    assert.equal(s.label, "conferir");
  });

  it("os dois lados ganhando é ambíguo — não sugere", () => {
    const s = suggestSettle({
      marketArbi: "Mais de 0.5 gols",
      marketCasa: "Mais de 1.5 gols",
      home: 2,
      away: 1,
      finished: FT,
      homeTeam: "A",
      awayTeam: "B",
    });
    assert.equal(s.winningSide, null);
    assert.match(s.reason, /ambíguo/);
  });
});

describe("placar exato (proteções LAY de correct score)", () => {
  const t = { homeTeam: "Juventus", awayTeam: "Nice" };

  it("acerta o placar → seleção aconteceu", () => {
    assert.equal(marketStatus("Lay 0x1", 0, 1, FT, t), "win");
    assert.equal(marketStatus("Lay 3x2", 3, 2, FT, t), "win");
    assert.equal(marketStatus("Placar exato 1-0", 1, 0, FT, t), "win");
  });

  it("erra o placar → não aconteceu", () => {
    assert.equal(marketStatus("Lay 0x1", 2, 0, FT, t), "lose");
    assert.equal(marketStatus("Lay 2x2", 0, 0, FT, t), "lose");
    assert.equal(marketStatus("Lay 0x0", 2, 1, FT, t), "lose");
  });

  it("respeita a ordem: 0x1 não é 1x0", () => {
    assert.equal(marketStatus("Lay 0x1", 1, 0, FT, t), "lose");
    assert.equal(marketStatus("Lay 1x0", 1, 0, FT, t), "win");
  });

  it("em andamento fica pendente", () => {
    assert.equal(marketStatus("Lay 0x1", 0, 1, LIVE, t), "pending");
  });

  it("não engole linha de gols, handicap nem DNB", () => {
    assert.equal(marketStatus("MENOS DE 1.5 GOLS NA PARTIDA", 0, 0, FT, t), "win");
    assert.equal(marketStatus("MAIS DE 1.5 GOLS NA PARTIDA", 0, 0, FT, t), "lose");
    assert.equal(marketStatus("Handicap -1.25", 2, 0, FT, t), null);
    assert.equal(
      marketStatus("Juventus EMPATE ANULA", 2, 0, FT, t),
      "win",
      "DNB não pode virar placar exato"
    );
  });

  it("LAY de placar exato que não saiu → cliente ganhou", () => {
    // Espelha a regra do relatório de proteções: LAY ganha quando não acontece.
    const naoAconteceu = marketStatus("Lay 0x1", 2, 0, FT, t) === "lose";
    assert.equal(naoAconteceu, true);
  });
});

describe("outcome da proteção: BACK e LAY invertem", () => {
  const base = { home: 2, away: 0, finished: true, homeTeam: "LASK", awayTeam: "Nice" };

  // Regra do dono: LAY de placar que GANHA (o placar não saiu) é Ganho, não
  // Reembolso. A ArbiShield reembolsa quando a indicação PERDE.
  it("LAY de placar exato que não saiu → Ganho", () => {
    const r = suggestProtectionOutcome({ ...base, kind: "LAY", marketName: "Lay 0x1" });
    assert.equal(r.outcome, "exchange");
    assert.equal(r.label, "Ganho");
  });

  it("LAY de placar exato que saiu → Reembolso", () => {
    const r = suggestProtectionOutcome({
      ...base,
      home: 0,
      away: 1,
      kind: "LAY",
      marketName: "Lay 0x1",
    });
    assert.equal(r.outcome, "arbishield");
    assert.equal(r.label, "Reembolso");
  });

  it("BACK é o espelho do LAY no mesmo mercado e placar", () => {
    const lay = suggestProtectionOutcome({ ...base, kind: "LAY", marketName: "Mandante" });
    const back = suggestProtectionOutcome({ ...base, kind: "BACK", marketName: "Mandante" });
    assert.notEqual(lay.outcome, back.outcome);
    // Mandante aconteceu (2-0): BACK ganhou → Ganho; LAY perdeu → Reembolso
    assert.equal(back.outcome, "exchange");
    assert.equal(lay.outcome, "arbishield");
  });

  it("Reembolso só quando a indicação perde — nunca quando ganha", () => {
    const ganhou = suggestProtectionOutcome({ ...base, kind: "LAY", marketName: "Lay 0x1" });
    assert.notEqual(
      ganhou.label,
      "Reembolso",
      "indicação que ganha não pode virar Reembolso"
    );
    const perdeu = suggestProtectionOutcome({ ...base, kind: "BACK", marketName: "Lay 0x1" });
    assert.equal(perdeu.label, "Reembolso");
  });

  it("empate em Empate Anula → Anula, para os dois lados", () => {
    for (const kind of ["BACK", "LAY"]) {
      const r = suggestProtectionOutcome({
        ...base,
        home: 1,
        away: 1,
        kind,
        marketName: "LASK EMPATE ANULA",
      });
      assert.equal(r.outcome, "void");
    }
  });

  it("sem placar, sem fim de jogo ou mercado exótico não sugere nada", () => {
    assert.equal(
      suggestProtectionOutcome({ ...base, kind: "LAY", marketName: "Lay 0x1", finished: false })
        .outcome,
      null
    );
    assert.equal(
      suggestProtectionOutcome({ ...base, home: null, away: null, kind: "LAY", marketName: "Lay 0x1" })
        .outcome,
      null
    );
    assert.equal(
      suggestProtectionOutcome({ ...base, kind: "LAY", marketName: "Handicap -1.25" }).outcome,
      null
    );
  });
});

describe("concorda com a leitura do card", () => {
  const teams = { homeTeam: "LASK", awayTeam: "GRAZER AK" };

  it("Empate Anula resolve pelo time, não pelo empate", () => {
    assert.equal(marketTeamSide("LASK LINZ EMPATE ANULA", teams), "home");
    assert.equal(marketTeamSide("GRAZER AK EMPATE ANULA", teams), "away");
    assert.equal(marketStatus("LASK LINZ EMPATE ANULA", 2, 0, FT, teams), "win");
    assert.equal(marketStatus("GRAZER AK EMPATE ANULA", 2, 0, FT, teams), "lose");
    assert.equal(marketStatus("LASK LINZ EMPATE ANULA", 1, 1, FT, teams), "void");
  });

  it("1X2 e gols seguem a regra normal", () => {
    assert.equal(marketStatus("Empate", 1, 1, FT, teams), "win");
    assert.equal(marketStatus("Mandante", 2, 0, FT, teams), "win");
    assert.equal(marketStatus("Mais de 1.5 gols", 2, 0, LIVE, teams), "win");
  });
});
