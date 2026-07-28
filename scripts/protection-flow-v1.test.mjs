/**
 * Testes do FLUXO_PROTECAO_V1 (math pura).
 *   node scripts/protection-flow-v1.test.mjs
 */
import {
  calcLay,
  calcBack,
  settlementCreditCents,
  settlementStatusForOutcome,
  PROTECTION_FLOW_VERSION,
} from "./lib/protection-flow-scaffold.mjs";

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

assert(PROTECTION_FLOW_VERSION === "fluxo-protecao-v1", "versão");

// Spec: R$ 500 LAY @ 1.10
const lay = calcLay(50000, 1.1);
// lucro bruto = 50000 / 0.1 = 500000
assert(lay.stakeRealCents === 500000, `lucro bruto = 500000 got ${lay.stakeRealCents}`);
// taxa 4,5% = 22500
assert(lay.exchangeFeeCents === 22500, `taxa 4.5% = 22500 got ${lay.exchangeFeeCents}`);
// líquido = 477500
assert(
  lay.exchangeProfitNetCents === 477500,
  `líquido = 477500 got ${lay.exchangeProfitNetCents}`
);
// 1,5% de R = 750
assert(lay.userProfitCents === 750, `1.5% R = 750 got ${lay.userProfitCents}`);
// margem = 476750 (> R → reembolso Exchange 0)
assert(
  lay.arbiShieldDeductionCents === 476750,
  `margem = 476750 got ${lay.arbiShieldDeductionCents}`
);

const row = {
  amount_cents: 50000,
  platform_deduction_cents: lay.platformDeductionCents,
};
assert(settlementCreditCents(row, "arbishield") === 50000, "ArbiShield devolve 100%");
assert(settlementCreditCents(row, "exchange") === 0, "Exchange reembolso 0 (margem > R)");
assert(settlementStatusForOutcome("arbishield") === "lost_exchange", "status Arbi");
assert(settlementStatusForOutcome("exchange") === "won_exchange", "status Exchange");

// Odd alta: margem < R → reembolso parcial
const layHi = calcLay(50000, 3.0);
// lucro bruto = 50000/2 = 25000; fee=1125; net=23875; user=750; margem=23125
assert(layHi.arbiShieldDeductionCents === 23125, `margem @3.0 = 23125 got ${layHi.arbiShieldDeductionCents}`);
const rowHi = {
  amount_cents: 50000,
  platform_deduction_cents: layHi.platformDeductionCents,
};
assert(
  settlementCreditCents(rowHi, "exchange") === 50000 - 23125,
  `Exchange @3.0 credit = ${50000 - 23125}`
);

const back = calcBack(10000, 2.0);
assert(back.grossProfitCents === 10000, "BACK lucro bruto");
assert(back.exchangeFeeCents === 450, "BACK taxa 4.5%");
assert(back.userProfitCents === 150, "BACK 1.5%");
assert(back.arbiShieldDeductionCents === 10000 - 450 - 150, "BACK margem");

if (failed) {
  console.error(`\n${failed} falha(s)`);
  process.exit(1);
}
console.log("\nTodos os testes passaram.");
