#!/usr/bin/env node
/**
 * Corrige o outcome de UMA proteção liquidada errado, ajustando a carteira.
 *
 * Marker: `corrige-outcome-protecao-v1`
 *
 * Padrão é **dry-run**: só aplica com `--apply`. Antes de escrever, confere que
 * o estado é exatamente o esperado (outcome de origem, valores, saldo suficiente
 * e correção ainda não aplicada) — se algo divergir, aborta sem tocar em nada.
 *
 * Na VPS:
 *   ID=<uuid completo> DE=arbishield PARA=exchange \
 *     node /opt/arbishield/scripts/vps-corrigir-outcome-protecao.mjs
 *   ... mesma linha com --apply para executar
 */
import fs from "node:fs";
import path from "node:path";
import {
  protectionResultTerm,
  settlementCreditParts,
  settlementDeductionCents,
  creditBucketForSettlement,
} from "./lib/protection-flow-contract.mjs";

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") process.env[key] = val;
  }
}
for (const f of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean)) {
  loadEnvFile(f);
}

const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");
const ID = String(process.env.ID || "").trim();
const DE = String(process.env.DE || "arbishield").trim().toLowerCase();
const PARA = String(process.env.PARA || "exchange").trim().toLowerCase();
const APPLY = process.argv.includes("--apply");
const MOTIVO =
  process.env.MOTIVO ||
  "Outcome invertido na liquidação: indicação venceu (LAY de placar exato não saiu) → Ganho";

const FIX_MARKER = "corrige-outcome-protecao-v1";

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente (rode na VPS)");
  process.exit(1);
}
if (ID.length < 32) {
  console.error("Informe ID com o uuid COMPLETO (prefixo não é aceito aqui).");
  process.exit(2);
}
if (!["arbishield", "exchange", "void"].includes(PARA)) {
  console.error("PARA deve ser arbishield, exchange ou void");
  process.exit(2);
}

async function sb(pathname, { method = "GET", body } = {}) {
  const res = await fetch(SUPABASE_URL + pathname, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || text.slice(0, 200) || res.statusText);
    err.status = res.status;
    if (data && data.code) err.code = String(data.code);
    throw err;
  }
  return data;
}

const money = (c) =>
  (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n = (v) => Number(v || 0);
const metaOf = (r) => (r && r.metadata && typeof r.metadata === "object" ? r.metadata : {});

function aborta(msg) {
  console.error(`\nABORTADO: ${msg}`);
  console.error("Nada foi alterado.\n");
  process.exit(4);
}

// ------------------------------------------------------------------ leitura ---
let row = null;
let table = null;
for (const t of ["protections", "back_protections"]) {
  const rows = await sb(`/rest/v1/${t}?select=*&id=eq.${encodeURIComponent(ID)}&limit=1`);
  if (Array.isArray(rows) && rows[0]) {
    row = rows[0];
    table = t;
    break;
  }
}
if (!row) aborta(`proteção ${ID} não encontrada`);

const outcomeAtual = String(row.settled_outcome || "").toLowerCase();
if (outcomeAtual !== DE) {
  aborta(
    `outcome atual é "${outcomeAtual || "(vazio)"}", esperado "${DE}" — ` +
      "confira se a correção já foi aplicada"
  );
}
if (outcomeAtual === PARA) aborta("outcome já é o desejado");

const prof = (
  await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`
  )
)[0];
if (!prof) aborta(`perfil ${row.user_id} não encontrado`);

let txs = [];
try {
  txs = await sb(
    `/rest/v1/wallet_transactions?select=*&ref=eq.${encodeURIComponent(row.id)}&order=created_at.asc`
  );
} catch (err) {
  console.warn(`aviso: não li wallet_transactions (${err.message})`);
}
const jaCorrigida = (Array.isArray(txs) ? txs : []).some(
  (t) => metaOf(t).fix === FIX_MARKER
);
if (jaCorrigida) aborta("já existe transação de correção para esta proteção");

// ------------------------------------------------------------------- cálculo --
const amount = n(row.responsibility_cents || row.amount_cents);
const fee = settlementDeductionCents(row);
const creditadoAntes = settlementCreditParts(row, DE).total;
const bucketAntes = creditBucketForSettlement("REAL", row, DE);
const creditoNovo = settlementCreditParts(row, PARA).total;
const bucketNovo = creditBucketForSettlement("REAL", row, PARA);

if (amount <= 0) aborta("valor da proteção é zero");
if (bucketAntes !== "deduction_balance_cents") {
  aborta(`bucket de origem inesperado (${bucketAntes}) — este script cobre só Saldo Reembolso`);
}
if (n(prof.deduction_balance_cents) < creditadoAntes) {
  aborta(
    `Saldo Reembolso é ${money(prof.deduction_balance_cents)}, menor que o crédito indevido ` +
      `${money(creditadoAntes)} — o dinheiro já pode ter sido movido/sacado`
  );
}

/**
 * O destravamento no settle **já devolveu o stake à origem** — verificado no
 * caso do Senilvo: Apostador 783,86 + travado 150 → 933,86 no fim da operação.
 * Então a correção NÃO devolve o stake de novo; ela só tira o crédito indevido
 * do Saldo Reembolso e cobra a dedução que faltou.
 *
 * STAKE_JA_DEVOLVIDO=0 força o comportamento antigo (devolver o stake também),
 * para o caso de aparecer proteção em que o destravamento não creditou a origem.
 */
const stakeJaDevolvido = process.env.STAKE_JA_DEVOLVIDO !== "0";

const deducaoNova = { ...prof };
deducaoNova.deduction_balance_cents = n(prof.deduction_balance_cents) - creditadoAntes;
if (PARA === "exchange") {
  // Ganho: stake na origem (já devolvido) e cobra só a dedução.
  deducaoNova.balance_cents =
    n(prof.balance_cents) + (stakeJaDevolvido ? 0 : amount) - fee;
} else if (PARA === "void") {
  deducaoNova.balance_cents = n(prof.balance_cents) + (stakeJaDevolvido ? 0 : amount);
} else {
  deducaoNova.deduction_balance_cents += creditoNovo;
}
if (deducaoNova.balance_cents < 0 || deducaoNova.deduction_balance_cents < 0) {
  aborta("correção deixaria saldo negativo");
}

const statusNovo =
  PARA === "exchange" ? "won_exchange" : PARA === "void" ? "void" : "lost_exchange";

console.log(`\nCorreção de outcome · ${FIX_MARKER} · ${APPLY ? "APLICANDO" : "DRY-RUN"}\n`);
console.log(`  proteção   ${row.id} (${table})`);
console.log(`  cliente    ${prof.full_name || prof.id}`);
console.log(`  mercado    ${metaOf(row).market_name || "(não registrado)"} · odd ${row.odd ?? "?"}`);
console.log(`  valor      ${money(amount)} · dedução ${money(fee)}`);
console.log(
  `  outcome    ${DE} (${protectionResultTerm(DE)}) → ${PARA} (${protectionResultTerm(PARA)})`
);
console.log(`  status     ${row.status} → ${statusNovo}`);
console.log(`  motivo     ${MOTIVO}`);

console.log("\n  carteira");
console.log(
  `    Apostador        ${money(prof.balance_cents)} → ${money(deducaoNova.balance_cents ?? prof.balance_cents)}`
);
console.log(`    Travado          ${money(prof.locked_balance_cents)} (não muda)`);
console.log(
  `    Saldo Reembolso  ${money(prof.deduction_balance_cents)} → ${money(deducaoNova.deduction_balance_cents)}`
);
console.log("\n  o que a correção faz");
console.log(`    estorna ${money(creditadoAntes)} do Saldo Reembolso (crédito indevido)`);
if (PARA === "exchange") {
  console.log(
    stakeJaDevolvido
      ? `    stake ${money(amount)} JÁ estava na origem (destravado no settle) — não devolve de novo`
      : `    devolve o stake ${money(amount)} à origem`
  );
  if (fee > 0) console.log(`    cobra a dedução ${money(fee)} do Apostador`);
}

if (!APPLY) {
  console.log("\n  dry-run: nada foi alterado. Repita com --apply para executar.\n");
  process.exit(0);
}

// ------------------------------------------------------------------ aplica ----
const agora = new Date().toISOString();
const patchPerfil = {
  deduction_balance_cents: deducaoNova.deduction_balance_cents,
  updated_at: agora,
};
if (deducaoNova.balance_cents != null && deducaoNova.balance_cents !== n(prof.balance_cents)) {
  patchPerfil.balance_cents = deducaoNova.balance_cents;
}

console.log("\n  1/3 ajustando a carteira");
await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(prof.id)}`, {
  method: "PATCH",
  body: patchPerfil,
});

console.log("  2/3 registrando a auditoria");
const txBase = {
  user_id: prof.id,
  type: "protection_settlement_fix",
  amount_cents: (deducaoNova.balance_cents ?? n(prof.balance_cents)) - n(prof.balance_cents),
  ref: row.id,
  metadata: {
    fix: FIX_MARKER,
    protection_id: row.id,
    match_id: row.match_id || null,
    outcome_antes: DE,
    outcome_depois: PARA,
    termo_antes: protectionResultTerm(DE),
    termo_depois: protectionResultTerm(PARA),
    estorno_reembolso_cents: creditadoAntes,
    stake_ja_devolvido_no_settle: stakeJaDevolvido,
    stake_devolvido_agora_cents:
      !stakeJaDevolvido && (PARA === "exchange" || PARA === "void") ? amount : 0,
    deducao_cobrada_cents: PARA === "exchange" ? fee : 0,
    saldo_antes: {
      balance_cents: n(prof.balance_cents),
      deduction_balance_cents: n(prof.deduction_balance_cents),
    },
    saldo_depois: {
      balance_cents: deducaoNova.balance_cents ?? n(prof.balance_cents),
      deduction_balance_cents: deducaoNova.deduction_balance_cents,
    },
    motivo: MOTIVO,
  },
};
try {
  await sb("/rest/v1/wallet_transactions", { method: "POST", body: txBase });
} catch (err) {
  console.warn(`  aviso: auditoria não gravada (${err.message})`);
}

console.log("  3/3 marcando a proteção");
const tentativas = [
  { status: statusNovo, settled_outcome: PARA, settled_at: row.settled_at || agora },
  { status: statusNovo, settled_outcome: PARA },
  { settled_outcome: PARA },
];
let marcada = false;
let ultimoErro = null;
for (const corpo of tentativas) {
  try {
    await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: { ...corpo, updated_at: agora },
    });
    marcada = true;
    break;
  } catch (err) {
    ultimoErro = err;
  }
}
if (!marcada) {
  console.error(
    `\nATENÇÃO: carteira ajustada, mas a proteção NÃO foi remarcada (${ultimoErro?.message}).`
  );
  console.error("Corrija status/settled_outcome à mão para não reprocessar.\n");
  process.exit(5);
}

const depois = (
  await sb(
    `/rest/v1/profiles?select=balance_cents,locked_balance_cents,deduction_balance_cents&id=eq.${encodeURIComponent(prof.id)}&limit=1`
  )
)[0];
console.log("\n  conferência final");
console.log(`    Apostador        ${money(depois?.balance_cents)}`);
console.log(`    Travado          ${money(depois?.locked_balance_cents)}`);
console.log(`    Saldo Reembolso  ${money(depois?.deduction_balance_cents)}`);
console.log("\nOK correção aplicada.\n");
