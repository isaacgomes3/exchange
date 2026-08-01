#!/usr/bin/env node
/**
 * Estado exato de uma proteção já liquidada — para corrigir outcome errado.
 *
 * SÓ LEITURA. Mostra a proteção, a partida, a carteira do cliente e as
 * transações ligadas, e calcula o que teria acontecido com o outcome correto.
 * O delta impresso é o que uma correção precisaria aplicar.
 *
 * Na VPS:
 *   ID=1f853986 PARA=exchange node /opt/arbishield/scripts/vps-diag-protecao-liquidada.mjs
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
const PARA = String(process.env.PARA || "exchange").trim().toLowerCase();

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente (rode na VPS)");
  process.exit(1);
}
if (!ID) {
  console.error("Informe ID=<id ou prefixo da proteção> [PARA=exchange|arbishield|void]");
  process.exit(2);
}

async function sb(pathname) {
  const res = await fetch(SUPABASE_URL + pathname, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${pathname} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

const money = (c) =>
  (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const metaOf = (r) => (r && r.metadata && typeof r.metadata === "object" ? r.metadata : {});

/**
 * `id` é uuid: PostgREST não aceita `like` nele, então prefixo é filtrado aqui.
 * E o erro NÃO é engolido — antes, qualquer falha virava "não encontrada".
 */
async function acha(table, kind) {
  const marca = (rows) =>
    (Array.isArray(rows) ? rows : []).map((r) => ({ ...r, _kind: kind, _table: table }));
  if (ID.length >= 32) {
    return marca(await sb(`/rest/v1/${table}?select=*&id=eq.${encodeURIComponent(ID)}&limit=2`));
  }
  const alvo = ID.toLowerCase();
  const rows = await sb(
    `/rest/v1/${table}?select=*&order=settled_at.desc.nullslast&limit=1000`
  );
  return marca((Array.isArray(rows) ? rows : []).filter((r) =>
    String(r.id || "").toLowerCase().startsWith(alvo)
  ));
}

const achados = [];
const falhas = [];
for (const [table, kind] of [
  ["protections", "LAY"],
  ["back_protections", "BACK"],
]) {
  try {
    achados.push(...(await acha(table, kind)));
  } catch (err) {
    falhas.push(`${table}: ${err.message}`);
  }
}
if (!achados.length) {
  console.error(`Proteção ${ID} não encontrada.`);
  if (falhas.length) {
    console.error("Falhas ao consultar (não é 'não existe', é erro de leitura):");
    for (const f of falhas) console.error("  " + f);
  } else {
    console.error("As duas tabelas responderam e nenhum id começa com esse prefixo.");
    console.error("Confira o id completo na tela ou no relatório de proteções.");
  }
  process.exit(3);
}
if (achados.length > 1) {
  console.error(`Prefixo ${ID} casou com ${achados.length} proteções — informe o id completo:`);
  for (const r of achados) console.error("  " + r.id + "  " + r._table);
  process.exit(3);
}

const row = achados[0];
const meta = metaOf(row);
const match = row.match_id
  ? (await sb(`/rest/v1/matches?select=*&id=eq.${encodeURIComponent(row.match_id)}&limit=1`))[0]
  : null;
const prof = (
  await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,demo_balance_cents,investor_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`
  )
)[0];
let txs = [];
try {
  txs = await sb(
    `/rest/v1/wallet_transactions?select=*&ref=eq.${encodeURIComponent(row.id)}&order=created_at.asc`
  );
} catch {
  /* tabela pode ter outro nome */
}

const outcomeAtual = String(row.settled_outcome || "").toLowerCase();
const amount = Number(row.responsibility_cents || row.amount_cents || 0);
const feeCents = settlementDeductionCents(row);
const atual = settlementCreditParts(row, outcomeAtual);
const correto = settlementCreditParts(row, PARA);
const bucketAtual = creditBucketForSettlement("REAL", row, outcomeAtual);
const bucketCorreto = creditBucketForSettlement("REAL", row, PARA);

console.log("\nProteção liquidada · diagnóstico · SÓ LEITURA\n");
console.log(`  id            ${row.id}`);
console.log(`  tabela/tipo   ${row._table} (${row._kind})`);
console.log(`  cliente       ${prof?.full_name || row.user_id}`);
console.log(`  partida       ${match ? [match.home_team, match.away_team].filter(Boolean).join(" x ") : row.match_id}`);
console.log(`  placar        ${match?.final_score_home ?? "?"}-${match?.final_score_away ?? "?"}`);
console.log(`  mercado       ${meta.market_name || row.market_name || "(não registrado)"}`);
console.log(`  odd           ${row.odd ?? "?"}`);
console.log(`  valor         ${money(amount)}  (dedução ${money(feeCents)})`);
console.log(`  status        ${row.status}`);
console.log(`  outcome       ${outcomeAtual || "(vazio)"}  → ${protectionResultTerm(outcomeAtual) || "?"}`);
console.log(`  liquidada em  ${row.settled_at || "?"}`);

console.log("\n  carteira do cliente agora");
console.log(`    Apostador        ${money(prof?.balance_cents)}`);
console.log(`    Travado          ${money(prof?.locked_balance_cents)}`);
console.log(`    Saldo Reembolso  ${money(prof?.deduction_balance_cents)}`);

console.log(`\n  transações ligadas (${txs.length})`);
for (const t of txs) {
  console.log(
    `    ${String(t.created_at || "").slice(0, 19)}  ${String(t.type).padEnd(24)} ` +
      `${money(t.amount_cents)}  ${metaOf(t).outcome || ""} ${metaOf(t).bucket || ""}`
  );
}
if (!txs.length) console.log("    (nenhuma — ou a tabela usa outro nome/ref)");

console.log(`\n  o que foi aplicado (${protectionResultTerm(outcomeAtual) || outcomeAtual})`);
console.log(`    creditado ${money(atual.total)} em ${bucketAtual}`);
console.log(`\n  o que o outcome correto (${protectionResultTerm(PARA) || PARA}) faria`);
console.log(`    creditado ${money(correto.total)} em ${bucketCorreto}`);
if (PARA === "exchange") {
  console.log(`    stake ${money(amount)} devolvido à origem · dedução ${money(feeCents)} cobrada`);
}

console.log("\n  DELTA a corrigir");
if (outcomeAtual === PARA) {
  console.log("    nenhum — o outcome já é o desejado");
} else {
  if (atual.total > 0) {
    console.log(`    debitar  ${money(atual.total)} de ${bucketAtual}   (crédito indevido)`);
  }
  if (PARA === "exchange") {
    console.log(`    creditar ${money(amount)} em balance_cents        (stake à origem)`);
    if (feeCents > 0) {
      console.log(`    debitar  ${money(feeCents)} de balance_cents      (dedução ArbiShield)`);
      console.log(`    efeito líquido na origem: ${money(amount - feeCents)}`);
    }
  } else if (correto.total > 0) {
    console.log(`    creditar ${money(correto.total)} em ${bucketCorreto}`);
  }
  console.log(`    marcar proteção como ${PARA} (status/settled_outcome)`);
}
console.log("\nNada foi alterado por este diagnóstico.\n");
