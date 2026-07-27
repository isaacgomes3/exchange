/**
 * Regressão do fluxo de proteção — falha o CI se alguém alterar as regras
 * sem atualizar este contrato de propósito (e sem pedido explícito).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROTECTION_FLOW_CONTRACT_VERSION,
  PROTECTION_FLOW_LOCK,
  STAKE_LOCK_RULE,
  MAX_STAKE_FRACTION_OF_APOSTADOR,
  maxStakeLockCents,
  apostadorRemainingAfterLock,
  calcFeeUpfront,
  calcLay,
  calcBack,
  settlementCreditParts,
  settlementDeductionCents,
  creditBucketForSettlement,
  settlementStatusForOutcome,
  isFeeUpfrontProtection,
  isStakeLockProtection,
  isVoidSettleOutcome,
  normalizeSettleOutcome,
} from "./lib/protection-flow-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("contrato travado — metadados", () => {
  it("mantém versão e lock", () => {
    assert.equal(PROTECTION_FLOW_CONTRACT_VERSION, "protection-flow-contract-v5");
    assert.equal(STAKE_LOCK_RULE, "stake-lock-v1");
    assert.equal(MAX_STAKE_FRACTION_OF_APOSTADOR, 0.5);
    assert.equal(
      PROTECTION_FLOW_LOCK,
      "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST"
    );
  });

  it("AGENTS.md cita a regra vigente stake_lock + 50%", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    assert.match(agents, /DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST/);
    assert.match(agents, /protection-flow-contract-v5/);
    assert.match(agents, /stake_lock_v1/);
    assert.match(agents, /trava o stake/);
    assert.match(agents, /50%/);
    assert.match(agents, /Saldo Reembolso/);
    assert.match(agents, /Ganhou na ArbiShield/);
    assert.match(agents, /Ganhou na Exchange/);
    assert.match(agents, /Empate Anula/);
  });

  it("prelive e shim importam o contrato", () => {
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    const shim = readFileSync(
      resolve(root, "scripts/arbishield-serverfn-shim.mjs"),
      "utf8"
    );
    assert.match(prelive, /protection-flow-contract\.mjs/);
    assert.match(shim, /protection-flow-contract\.mjs/);
    assert.match(prelive, /PROTECTION_FLOW_LOCK/);
    assert.match(shim, /PROTECTION_FLOW_LOCK/);
    assert.match(prelive, /maxStakeLockCents/);
    assert.doesNotMatch(prelive, /function settlementCreditParts\s*\(/);
    assert.doesNotMatch(shim, /function settlementCreditParts\s*\(/);
  });

  it("create-protection e UI aplicam teto 50%", () => {
    const createTs = readFileSync(
      resolve(root, "src/lib/arbishield/create-protection.ts"),
      "utf8"
    );
    const ui = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-proteger.html"),
      "utf8"
    );
    assert.match(createTs, /maxStakeLockCents/);
    assert.match(createTs, /MAX_STAKE_FRACTION_OF_APOSTADOR/);
    assert.match(ui, /maxStakeLockCents/);
    assert.match(ui, /50%/);
  });

  it("carteira do cliente exibe Saldo Reembolso", () => {
    const html = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-carteira.html"),
      "utf8"
    );
    assert.match(html, /Saldo Reembolso/);
    assert.doesNotMatch(html, /Saldo Dedução/);
  });
});

describe("ativação — teto 50% Apostador", () => {
  it("maxStakeLockCents = floor(50% disponível)", () => {
    assert.equal(maxStakeLockCents(100_000), 50_000);
    assert.equal(maxStakeLockCents(1), 0);
    assert.equal(maxStakeLockCents(0), 0);
    assert.equal(maxStakeLockCents(-10), 0);
    assert.equal(maxStakeLockCents(99), 49);
  });

  it("eventos sucessivos: 50% do restante após cada trava", () => {
    // Banca 1000 → evento1 máx 500; usa 500 → resta 500 → evento2 máx 250;
    // usa 250 → resta 250 → evento3 máx 125.
    let avail = 100_000;
    const caps = [];
    for (let i = 0; i < 3; i++) {
      const cap = maxStakeLockCents(avail);
      caps.push(cap);
      avail = apostadorRemainingAfterLock(avail, cap);
    }
    assert.deepEqual(caps, [50_000, 25_000, 12_500]);
    assert.equal(avail, 12_500);
  });

  it("AGENTS.md descreve o teto sucessivo sobre o restante", () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    assert.match(agents, /sucessivamente/);
    assert.match(agents, /50% do que sobrou/);
  });
});

describe("cálculo dedução", () => {
  it("LAY @ 20 resp. R$1000 → dedução conhecida", () => {
    const c = calcLay(100_000, 20);
    assert.equal(c.input_mode, "responsabilidade");
    assert.equal(c.odd, 20);
    assert.equal(c.billing_model, "stake_lock_v1");
    assert.equal(c.arbiShieldDeductionCents, 3763);
  });

  it("BACK usa stake direto", () => {
    const c = calcBack(10_000, 2);
    assert.equal(c.input_mode, "stake");
    assert.equal(
      c.arbiShieldDeductionCents,
      calcFeeUpfront(10_000, 2).arbiShieldDeductionCents
    );
  });
});

describe("settle — stake_lock vigente", () => {
  const row = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    platform_deduction_cents: 3763,
    metadata: { billing_model: "stake_lock_v1", stake_lock: true },
  };

  it("detecta stake_lock (não fee_upfront)", () => {
    assert.equal(isStakeLockProtection(row), true);
    assert.equal(isFeeUpfrontProtection(row), false);
    assert.equal(settlementDeductionCents(row), 3763);
  });

  it("Ganhou na ArbiShield credita só o stake → Reembolso", () => {
    assert.equal(normalizeSettleOutcome("arbishield"), "arbishield");
    assert.deepEqual(settlementCreditParts(row, "arbishield"), {
      stake: 100_000,
      fee: 0,
      total: 100_000,
    });
    assert.equal(
      creditBucketForSettlement("REAL", row, "arbishield"),
      "deduction_balance_cents"
    );
  });

  it("Ganhou na Exchange → R$ 0 (não Reembolso)", () => {
    assert.deepEqual(settlementCreditParts(row, "exchange"), {
      stake: 0,
      fee: 0,
      total: 0,
    });
  });

  it("Empate Anula → stake (destino = origem, não Reembolso)", () => {
    assert.equal(isVoidSettleOutcome("empate_anula"), true);
    assert.deepEqual(settlementCreditParts(row, "void"), {
      stake: 100_000,
      fee: 0,
      total: 100_000,
    });
    assert.equal(
      creditBucketForSettlement("REAL", row, "void"),
      "balance_cents"
    );
    assert.equal(
      creditBucketForSettlement("DEMO", row, "void"),
      "demo_balance_cents"
    );
  });

  it("status corretos", () => {
    assert.equal(settlementStatusForOutcome("arbishield"), "lost_exchange");
    assert.equal(settlementStatusForOutcome("exchange"), "won_exchange");
    assert.equal(settlementStatusForOutcome("empate_anula"), "void");
  });
});

describe("settle — histórico fee_upfront", () => {
  const row = {
    amount_cents: 100_000,
    responsibility_cents: 100_000,
    platform_deduction_cents: 3763,
    metadata: { billing_model: "fee_upfront_v1", fee_upfront: true },
  };

  it("ArbiShield devolve stake + dedução", () => {
    assert.equal(isFeeUpfrontProtection(row), true);
    assert.deepEqual(settlementCreditParts(row, "arbishield"), {
      stake: 100_000,
      fee: 3763,
      total: 103_763,
    });
  });

  it("Exchange → 0", () => {
    assert.deepEqual(settlementCreditParts(row, "exchange"), {
      stake: 0,
      fee: 0,
      total: 0,
    });
  });

  it("Empate Anula devolve só a dedução (histórico)", () => {
    assert.deepEqual(settlementCreditParts(row, "void"), {
      stake: 0,
      fee: 3763,
      total: 3763,
    });
    assert.equal(
      creditBucketForSettlement("REAL", row, "void"),
      "deduction_balance_cents"
    );
  });
});

describe("anti-regressão — Exchange nunca Reembolso", () => {
  it("exchange.total === 0 em stake_lock e fee_upfront", () => {
    const lock = {
      amount_cents: 50_000,
      platform_deduction_cents: 1000,
      metadata: { billing_model: "stake_lock_v1" },
    };
    const feeUp = {
      amount_cents: 50_000,
      platform_deduction_cents: 1000,
      metadata: { billing_model: "fee_upfront_v1", fee_upfront: true },
    };
    assert.equal(settlementCreditParts(lock, "exchange").total, 0);
    assert.equal(settlementCreditParts(feeUp, "exchange").total, 0);
  });
});
