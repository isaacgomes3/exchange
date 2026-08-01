/**
 * Anti-regressão: marcador V/×/E do mercado no card do Desafio.
 *
 * Empate Anula (DNB) é aposta NO TIME com estorno no empate — nunca aposta no
 * empate. Tratar como 1X2 "Empate" marcava × nos dois lados do card sempre que
 * o jogo não terminava empatado (marker desafio-dnb-flag-v1).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const htmlPath = "deploy/vps-supabase/static/v2/app-desafio.html";
const html = readFileSync(resolve(root, htmlPath), "utf8");

/** Recorta `function nome(...) { ... }` do HTML equilibrando as chaves. */
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${htmlPath} sem function ${name}`);
  let depth = 0;
  for (let i = html.indexOf("{", start); i < html.length; i += 1) {
    if (html[i] === "{") depth += 1;
    else if (html[i] === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} sem fechamento`);
}

function extractVar(name) {
  const m = html.match(new RegExp(`^\\s*var ${name} = .*;$`, "m"));
  assert.ok(m, `${htmlPath} sem var ${name}`);
  return m[0];
}

const marketDecidedStatus = new Function(
  [
    extractVar("DNB_RE"),
    extractFunction("normMarketLabel"),
    extractFunction("teamNameTokens"),
    extractFunction("namesOverlap"),
    extractFunction("marketDecidedStatus"),
    "return marketDecidedStatus;",
  ].join("\n")
)();

const FT = true;
const LIVE = false;

describe("Desafio — Empate Anula (desafio-dnb-flag-v1)", () => {
  it("LASK 2x0 Grazer AK: cada lado recebe seu próprio resultado", () => {
    const teams = { homeTeam: "LASK", awayTeam: "GRAZER AK" };
    assert.equal(
      marketDecidedStatus("LASK LINZ EMPATE ANULA", 2, 0, FT, teams),
      "win"
    );
    assert.equal(
      marketDecidedStatus("GRAZER AK EMPATE ANULA", 2, 0, FT, teams),
      "lose"
    );
  });

  it("Argeș Pitești 1x0 Csíkszereda: acentos não atrapalham o casamento", () => {
    const teams = {
      homeTeam: "ARGEȘ PITEȘTI",
      awayTeam: "CSÍKSZEREDA MIERCUREA CIUC",
    };
    assert.equal(
      marketDecidedStatus("ARGEȘ PITEȘTI EMPATE ANULA", 1, 0, FT, teams),
      "win"
    );
    assert.equal(
      marketDecidedStatus("CSÍKSZEREDA EMPATE ANULA", 1, 0, FT, teams),
      "lose"
    );
  });

  it("empate devolve o valor: os dois lados ficam em void, nunca em win", () => {
    const teams = { homeTeam: "LASK", awayTeam: "GRAZER AK" };
    assert.equal(
      marketDecidedStatus("LASK LINZ EMPATE ANULA", 1, 1, FT, teams),
      "void"
    );
    assert.equal(
      marketDecidedStatus("GRAZER AK EMPATE ANULA", 1, 1, FT, teams),
      "void"
    );
  });

  it("só fecha no fim do jogo", () => {
    const teams = { homeTeam: "LASK", awayTeam: "GRAZER AK" };
    assert.equal(
      marketDecidedStatus("LASK LINZ EMPATE ANULA", 2, 0, LIVE, teams),
      "pending"
    );
  });

  it("aceita Draw No Bet / DNB", () => {
    const teams = { homeTeam: "LASK", awayTeam: "GRAZER AK" };
    assert.equal(
      marketDecidedStatus("LASK Draw No Bet", 0, 3, FT, teams),
      "lose"
    );
    assert.equal(marketDecidedStatus("Grazer AK DNB", 0, 3, FT, teams), "win");
  });

  it("time indefinido não marca nada em vez de marcar errado", () => {
    const teams = { homeTeam: "LASK", awayTeam: "GRAZER AK" };
    assert.equal(
      marketDecidedStatus("Empate Anula", 2, 0, FT, teams),
      null
    );
    assert.equal(
      marketDecidedStatus("LASK LINZ EMPATE ANULA", 2, 0, FT, null),
      null
    );
  });
});

describe("Desafio — mercados 1X2 e gols seguem iguais", () => {
  const teams = { homeTeam: "LASK", awayTeam: "GRAZER AK" };

  it("Empate 1X2 continua resolvendo pelo empate", () => {
    assert.equal(marketDecidedStatus("Empate", 1, 1, FT, teams), "win");
    assert.equal(marketDecidedStatus("Empate", 2, 0, FT, teams), "lose");
  });

  it("Mandante / visitante", () => {
    assert.equal(marketDecidedStatus("Mandante", 2, 0, FT, teams), "win");
    assert.equal(marketDecidedStatus("Visitante", 2, 0, FT, teams), "lose");
  });

  it("Mais de 1.5 e ambas marcam", () => {
    assert.equal(marketDecidedStatus("Mais de 1.5 gols", 2, 0, LIVE, teams), "win");
    assert.equal(marketDecidedStatus("Ambas marcam - Sim", 1, 1, LIVE, teams), "win");
  });
});

describe("HTML publicado", () => {
  it("declara o marker e o estilo do estorno", () => {
    assert.match(html, /desafio-dnb-flag-v1/);
    assert.match(html, /\.dz-mkt-flag\.is-void/);
  });

  it("passa os times para o marcador nos dois painéis", () => {
    const calls = html.match(/marketLineHtml\(item\.market(Arbi|Casa), item\.liveInfo, \{/g);
    assert.equal(calls && calls.length, 2);
  });
});
