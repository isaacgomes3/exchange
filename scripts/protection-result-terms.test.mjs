/**
 * Vocabulário único do resultado da proteção (protection-result-terms-v1).
 * Captura do DESVIO de produção — só nomenclatura; crédito segue stake_lock_v1.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROTECTION_RESULT_TERMS,
  PROTECTION_RESULT_TERMS_VERSION,
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

  for (const [outcome, term] of Object.entries(ESPERADO)) {
    it(`${outcome} → ${term}`, () => {
      assert.equal(protectionResultTerm(outcome), term);
      assert.equal(protectionResultKind(outcome), term.toLowerCase());
      assert.ok(protectionResultHint(outcome).length > 10);
    });
  }

  it("aceita apelidos de empate anula", () => {
    for (const alias of ["void", "empate_anula", "anula", "dnb", "draw no bet"]) {
      assert.equal(protectionResultTerm(alias), "Anula", alias);
    }
  });
});

describe("v2.js espelha o contrato", () => {
  it("expõe helpers", () => {
    assert.match(V2, /protectionResultTerm: protectionResultTerm/);
    assert.match(V2, /protection-result-terms-v1/);
  });

  it("termos idênticos ao contrato", () => {
    for (const [outcome, term] of Object.entries(ESPERADO)) {
      const block = V2.slice(V2.indexOf(`${outcome}: {`));
      assert.match(
        block.slice(0, 200),
        new RegExp(`term: "${term}"`),
        `${outcome} deveria ser "${term}" no v2.js`
      );
    }
  });
});

describe("telas usam o termo único", () => {
  it("cliente lê ArbiV2 e trata Anula", () => {
    assert.match(CLIENTE, /protection-result-terms-v1/);
    assert.match(CLIENTE, /ArbiV2\.protectionResultTerm/);
    assert.match(CLIENTE, /kind: "void"/);
  });

  it("admin: GANHO / REEMBOLSO / ANULA", () => {
    assert.match(ADMIN, />GANHO</);
    assert.match(ADMIN, />REEMBOLSO</);
    assert.match(ADMIN, />ANULA</);
    assert.ok(!ADMIN.includes("BATEU ARBISHIELD"));
    assert.ok(!ADMIN.includes('id="editPublish"'));
  });
});

describe("direção do termo casa com a carteira", () => {
  const stakeLock = {
    amount_cents: 100000,
    metadata: { billing_model: "stake_lock_v1" },
  };

  it("Reembolso credita; Ganho não; Anula devolve stake", () => {
    assert.equal(settlementCreditParts(stakeLock, "arbishield").total, 100000);
    assert.equal(protectionResultTerm("arbishield"), "Reembolso");
    assert.equal(settlementCreditParts(stakeLock, "exchange").total, 0);
    assert.equal(protectionResultTerm("exchange"), "Ganho");
    assert.equal(settlementCreditParts(stakeLock, "void").stake, 100000);
    assert.equal(protectionResultTerm("void"), "Anula");
  });
});
