/**
 * Vocabulário único do resultado da proteção (protection-result-terms-v1).
 *
 * Pedido explícito (2026-08-01): a ArbiShield **não é casa de aposta** — não gera
 * ganho, só reembolsa quando a indicação perde. Então o nome sai da indicação:
 * bateu na casa = Ganho (`exchange`); perdeu = Reembolso (`arbishield`); empate
 * anula = Anula (`void`). Confere com a carteira: o Saldo Reembolso é creditado
 * justamente no `arbishield`.
 *
 * Antes, o cliente lia "Ganhou" quando havia sido reembolsado — este teste trava
 * a direção para não inverter de novo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROTECTION_RESULT_TERMS,
  PROTECTION_RESULT_TERMS_VERSION,
  PROTECTION_RESULT_WALLET_EFFECT,
  creditBucketForSettlement,
  protectionResultHint,
  protectionResultKind,
  protectionResultTerm,
  settlementCreditParts,
} from "./lib/protection-flow-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const V2 = read("deploy/vps-supabase/static/v2/v2.js");
const CLIENTE = read("deploy/vps-supabase/static/v2/app-protecoes.html");
const ADMIN = read("deploy/vps-supabase/static/v2/admin-jogos.html");

const ESPERADO = {
  arbishield: "Reembolso",
  exchange: "Ganho",
  void: "Anula",
};

describe("contrato: termo por outcome", () => {
  it("versão do vocabulário", () => {
    assert.equal(PROTECTION_RESULT_TERMS_VERSION, "protection-result-terms-v1");
  });

  it("os três outcomes e só eles", () => {
    assert.deepEqual(Object.keys(PROTECTION_RESULT_TERMS).sort(), [
      "arbishield",
      "exchange",
      "void",
    ]);
  });

  for (const [outcome, term] of Object.entries(ESPERADO)) {
    it(`${outcome} → ${term}`, () => {
      assert.equal(protectionResultTerm(outcome), term);
      assert.equal(protectionResultKind(outcome), term.toLowerCase());
      assert.ok(protectionResultHint(outcome).length > 10);
    });
  }

  it("aceita os apelidos de empate anula", () => {
    for (const alias of ["void", "empate_anula", "anula", "dnb", "draw no bet"]) {
      assert.equal(protectionResultTerm(alias), "Anula", alias);
    }
  });

  it("sem resultado devolve vazio, não inventa termo", () => {
    for (const v of ["", null, undefined, "qualquer", "won_exchange"]) {
      assert.equal(protectionResultTerm(v), "");
    }
  });
});

describe("v2.js espelha o contrato", () => {
  it("expõe os helpers para todas as telas", () => {
    assert.match(V2, /protectionResultTerm: protectionResultTerm/);
    assert.match(V2, /normalizeProtectionOutcome: normalizeProtectionOutcome/);
    assert.match(V2, /protection-result-terms-v1/);
  });

  it("os termos são idênticos aos do contrato", () => {
    for (const [outcome, term] of Object.entries(ESPERADO)) {
      const block = V2.slice(V2.indexOf(`${outcome}: {`));
      assert.match(
        block.slice(0, 200),
        new RegExp(`term: "${term}"`),
        `${outcome} deveria ser "${term}" no v2.js`
      );
    }
  });

  it("normaliza status legado do banco para o outcome", () => {
    const block = V2.slice(
      V2.indexOf("function normalizeProtectionOutcome"),
      V2.indexOf("function protectionResultTerm")
    );
    assert.match(block, /lost_exchange"\) return "arbishield"/);
    assert.match(block, /won_exchange"\) return "exchange"/);
  });
});

describe("as telas usam o termo único", () => {
  it("cliente lê o termo do ArbiV2 e trata Anula", () => {
    assert.match(CLIENTE, /protection-result-terms-v1/);
    assert.match(CLIENTE, /ArbiV2\.protectionResultTerm/);
    assert.match(CLIENTE, /kind: "void"/);
  });

  it("admin usa GANHO / REEMBOLSO / ANULA nos três botões", () => {
    assert.match(ADMIN, />GANHO</);
    assert.match(ADMIN, />REEMBOLSO</);
    assert.match(ADMIN, />ANULA</);
  });

  it("o vocabulário antigo não voltou — inclusive em avisos e alertas", () => {
    for (const antigo of [
      "BATEU ARBISHIELD",
      "BATEU CASA EXTERNA",
      "Onde bateu?",
      "Ganhou ArbiShield",
      "Exchange/PERDEU",
      "Casa externa ou",
      "sem reembolso (casa externa)",
    ]) {
      assert.ok(!ADMIN.includes(antigo), `admin-jogos ainda diz "${antigo}"`);
    }
    assert.ok(
      !CLIENTE.includes('label: won ? "Ganhou" : "Perdeu"'),
      "app-protecoes ainda usa Ganhou/Perdeu"
    );
  });

  it("os valores enviados ao settle continuam os mesmos", () => {
    assert.match(ADMIN, /data-outcome="arbishield"/);
    assert.match(ADMIN, /data-outcome="exchange"/);
    assert.match(ADMIN, /data-outcome="empate_anula"/);
  });
});

describe("a direção do termo casa com a carteira", () => {
  const stakeLock = { amount_cents: 100000, metadata: { billing_model: "stake_lock_v1" } };

  it("Reembolso é o outcome que credita — não pode ser chamado de Ganho", () => {
    assert.equal(settlementCreditParts(stakeLock, "arbishield").total, 100000);
    assert.equal(protectionResultTerm("arbishield"), "Reembolso");
  });

  it("Ganho não credita nada: o lucro veio da casa externa", () => {
    assert.equal(settlementCreditParts(stakeLock, "exchange").total, 0);
    assert.equal(protectionResultTerm("exchange"), "Ganho");
  });

  it("Anula devolve o stake à origem", () => {
    assert.equal(settlementCreditParts(stakeLock, "void").stake, 100000);
    assert.equal(protectionResultTerm("void"), "Anula");
  });

  it("ArbiShield não gera ganho — o termo Ganho nunca aponta para ela", () => {
    assert.notEqual(protectionResultTerm("arbishield"), "Ganho");
    assert.notEqual(protectionResultTerm("lost_exchange"), "Ganho");
  });

  it("no Reembolso o stake vai para o Saldo Reembolso, não para a origem", () => {
    assert.equal(
      creditBucketForSettlement("REAL", stakeLock, "arbishield"),
      "deduction_balance_cents"
    );
    assert.match(PROTECTION_RESULT_WALLET_EFFECT.arbishield, /Saldo Reembolso/);
    // O texto do rótulo não pode prometer devolução à origem nesse caso.
    assert.doesNotMatch(protectionResultHint("arbishield"), /à origem/);
  });

  it("Ganho e Anula devolvem à carteira de origem", () => {
    assert.equal(creditBucketForSettlement("REAL", stakeLock, "void"), "balance_cents");
    assert.match(PROTECTION_RESULT_WALLET_EFFECT.exchange, /à origem/);
    assert.match(PROTECTION_RESULT_WALLET_EFFECT.void, /à origem/);
  });
});
