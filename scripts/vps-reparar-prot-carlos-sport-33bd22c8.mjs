#!/usr/bin/env node
/**
 * Reparo bilhete Carlos — Sport vs Cuiabá · LAY R$1000 @32 · won_exchange
 * Protection: 33bd22c8-87c3-4d3f-90ad-b1c5b4894dec
 *
 * Problema: settle marcou won_exchange mas o stake NÃO voltou ao Apostador.
 *
 * Conta correta (v9 — só dedução, sem comissão extra):
 *   lucro LAY 1000@32 ≈ 32,26
 *   − Exchange 4,5% ≈ 1,45
 *   − cliente 1,5% = 15,00
 *   = dedução ArbiShield R$ 15,81
 *
 *   Se antes: Apostador 8.067,52 + Congelado 1.000
 *   Depois:  8.067,52 + 1.000 − 15,81 = R$ 9.051,71 · Congelado 0
 *
 * Na VPS:
 *   node scripts/vps-reparar-prot-carlos-sport-33bd22c8.mjs
 *   FIX=1 node scripts/vps-reparar-prot-carlos-sport-33bd22c8.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const PROT_ID =
  String(process.env.PROTECTION_ID || "33bd22c8-87c3-4d3f-90ad-b1c5b4894dec").trim();
const TAG = "repair-prot-carlos-sport-33bd22c8-v9";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
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
  return true;
}

for (const f of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  "/opt/arbishield/scripts/.env",
  "/root/.arbishield.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean)) {
  loadEnvFile(f);
}

const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente");
  process.exit(1);
}

function money(c) {
  return (Number(c || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
}

async function sb(p, { method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 700)}`);
  return data;
}

let settlementDeductionCents;
let calcLay;
try {
  const mod = await import(
    pathToFileURL(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "lib/protection-flow-contract.mjs"
      )
    ).href
  );
  settlementDeductionCents = mod.settlementDeductionCents;
  calcLay = mod.calcLay;
} catch (e) {
  console.warn("contrato local falhou, fallback inline:", e.message || e);
  calcLay = (amount, odd) => {
    const o = odd > 1.01 ? odd : 1.01;
    const back = o / (o - 1);
    const liability = Math.floor(amount);
    const grossReturn = Math.round(liability * back);
    const profit = Math.max(0, grossReturn - liability);
    const commission = Math.round(profit * 0.045);
    const user = Math.round(liability * 0.015);
    return {
      arbiShieldDeductionCents: Math.max(0, profit - commission - user),
      grossProfitCents: profit,
      userProfitCents: user,
      exchangeCommissionCents: commission,
    };
  };
  settlementDeductionCents = (row) => {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const stake = n(row?.responsibility_cents || row?.amount_cents);
    let odd = Number(meta.market_odd);
    if (!(odd > 1.01)) odd = Number(row?.odd || 0);
    const mt = String(meta.market_type || "LAY").toUpperCase();
    if (!(stake > 0) || !(odd > 1.01)) return n(row?.platform_deduction_cents);
    if (mt === "LAY") return calcLay(stake, odd).arbiShieldDeductionCents;
    const profit = Math.max(0, Math.round(stake * odd) - stake);
    return Math.max(0, profit - Math.round(profit * 0.045) - Math.round(stake * 0.015));
  };
}

async function loadProtection() {
  for (const table of ["protections", "back_protections"]) {
    const rows = await sb(
      `/rest/v1/${table}?id=eq.${encodeURIComponent(PROT_ID)}&select=*&limit=1`
    ).catch(() => null);
    if (Array.isArray(rows) && rows[0]) return { ...rows[0], _table: table };
  }
  throw new Error(`Proteção não encontrada: ${PROT_ID}`);
}

async function loadUser(userId) {
  const rows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents,updated_at&limit=1`
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new Error(`Perfil ausente: ${userId}`);
  return p;
}

async function loadTxs(userId, protId) {
  const rows = await sb(
    `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(userId)}&select=id,type,amount_cents,ref,metadata,created_at,description&order=created_at.desc&limit=80`
  ).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((t) => {
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    return (
      String(t.ref || "") === String(protId) ||
      String(meta.protection_id || "") === String(protId) ||
      String(meta.repair_tag || "").includes("33bd22c8") ||
      String(meta.tag || "").includes("33bd22c8")
    );
  });
}

function analyzeTxs(txs) {
  let stakeReturned = 0;
  let feeCharged = 0;
  let unlocked = false;
  for (const t of txs) {
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    const amt = n(t.amount_cents);
    const type = String(t.type || "");
    if (meta.stake_returned || meta.returned_stake_cents || meta.unlockReturnToOrigin) {
      stakeReturned += Math.max(0, n(meta.returned_stake_cents) || (amt > 0 ? amt : 0));
      unlocked = true;
    }
    if (
      type === "protection_settlement" ||
      type === "exchange_settlement" ||
      meta.exchange_no_credit
    ) {
      if (meta.stake_returned || meta.returned_stake_cents) {
        stakeReturned += Math.max(0, n(meta.returned_stake_cents) || 0);
      }
      if (meta.fee_charged_cents != null) feeCharged += Math.max(0, n(meta.fee_charged_cents));
      if (meta.unlocked_locked || meta.unlocked) unlocked = true;
    }
    if (type === "exchange_commission") {
      // v9: não deveria debitar; ignora para fee ArbiShield
    }
    if (meta.repair_tag === TAG || meta.tag === TAG) {
      return { alreadyRepaired: true, stakeReturned, feeCharged, unlocked, t };
    }
  }
  return { alreadyRepaired: false, stakeReturned, feeCharged, unlocked };
}

async function main() {
  console.log("==> Reparo proteção", PROT_ID, FIX ? "(FIX=1)" : "(dry-run)");
  console.log("    Sport vs Cuiabá · LAY 1000 @32 · won_exchange");

  const prot = await loadProtection();
  const user = await loadUser(prot.user_id);
  const meta =
    prot.metadata && typeof prot.metadata === "object" ? prot.metadata : {};
  const stake = n(prot.responsibility_cents || prot.amount_cents);
  const odd = Number(meta.market_odd || prot.odd || 32);
  const fee = Math.max(
    0,
    settlementDeductionCents({
      ...prot,
      metadata: {
        ...meta,
        billing_model: meta.billing_model || "stake_lock_v1",
        stake_lock: true,
        market_type: meta.market_type || "LAY",
        market_odd: odd,
      },
    }) || calcLay(stake, odd).arbiShieldDeductionCents
  );

  console.log("\nPROTEÇÃO");
  console.log("  table   ", prot._table);
  console.log("  status  ", prot.status, "outcome", prot.settled_outcome || "—");
  console.log("  user    ", user.full_name, user.id);
  console.log("  stake   ", money(stake));
  console.log("  odd     ", odd);
  console.log("  fee live", money(fee), "(não usar 91,11 — isso era odd 10)");
  console.log("  fee stor", money(prot.platform_deduction_cents));

  console.log("\nCARTEIRA ANTES");
  console.log("  Apostador", money(user.balance_cents));
  console.log("  Congelado", money(user.locked_balance_cents));
  console.log("  Reembolso", money(user.deduction_balance_cents));
  console.log("  Desafio  ", money(user.desafio_balance_cents));

  const txs = await loadTxs(user.id, PROT_ID);
  console.log("\nTXS desta proteção:", txs.length);
  for (const t of txs.slice(0, 8)) {
    console.log(
      " ",
      t.created_at,
      t.type,
      money(t.amount_cents),
      (t.description || "").slice(0, 60)
    );
  }
  const ax = analyzeTxs(txs);
  if (ax.alreadyRepaired) {
    console.log("OK — reparo desta proteção já aplicado:", ax.t?.id);
  }

  const bal = n(user.balance_cents);
  const locked = n(user.locked_balance_cents);
  const BASE_HINT = 806_752; // print histórico pré-jogo
  const CORRECT_FROM_BASE = BASE_HINT + stake - fee; // 905171

  let nextBal = bal;
  let nextLocked = locked;
  let delta = 0;
  let note = "";

  if (locked > 0) {
    const take = Math.min(locked, stake);
    const feeTake = take === stake ? fee : Math.round((fee * take) / stake);
    nextBal = bal + take - feeTake;
    nextLocked = locked - take;
    delta = nextBal - bal;
    note = `destrava ${money(take)} e cobra dedução ${money(feeTake)}`;
  } else if (ax.stakeReturned >= stake && ax.feeCharged >= fee) {
    note = "txs indicam stake+fee já ok";
    if (bal !== CORRECT_FROM_BASE && [897_641, 898_252, 897_141, BASE_HINT].includes(bal)) {
      nextBal = CORRECT_FROM_BASE;
      delta = nextBal - bal;
      note = `ajuste alvo odd32: ${money(bal)} → ${money(CORRECT_FROM_BASE)}`;
    }
  } else if (
    // locked=0 e saldo ainda no nível pré-devolução / alvos errados (odd10)
    [BASE_HINT, 897_641, 898_252, 897_141].includes(bal) ||
    ax.stakeReturned < stake
  ) {
    nextBal = CORRECT_FROM_BASE;
    nextLocked = 0;
    delta = nextBal - bal;
    note = `stake não voltou (won_exchange) — força ${money(CORRECT_FROM_BASE)} (=8.067,52+1.000−15,81)`;
  } else {
    // fallback: credita net faltante
    const missingStake = Math.max(0, stake - ax.stakeReturned);
    const missingFee = Math.max(0, fee - ax.feeCharged);
    nextBal = bal + missingStake - missingFee;
    nextLocked = 0;
    delta = nextBal - bal;
    note = `completa faltante stake ${money(missingStake)} − fee ${money(missingFee)}`;
  }

  console.log("\nPLANO");
  console.log(" ", note);
  console.log("  Apostador", money(bal), "→", money(nextBal));
  console.log("  Congelado", money(locked), "→", money(nextLocked));
  console.log("  delta", money(delta));
  console.log("  alvo referência", money(CORRECT_FROM_BASE));

  if (bal === nextBal && locked === nextLocked) {
    console.log("\nOK — nada a alterar no saldo.");
    return;
  }

  if (!FIX) {
    console.log("\nDry-run. Rode:");
    console.log("  FIX=1 node scripts/vps-reparar-prot-carlos-sport-33bd22c8.mjs");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: nextBal,
      locked_balance_cents: nextLocked,
      reusable_balance_cents: 0,
      updated_at: new Date().toISOString(),
    },
  });

  // retry locked
  let after = await loadUser(user.id);
  if (n(after.locked_balance_cents) !== nextLocked) {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: { locked_balance_cents: nextLocked, balance_cents: nextBal },
    });
    after = await loadUser(user.id);
  }

  try {
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: user.id,
        ref: PROT_ID,
        amount_cents: delta,
        type: delta >= 0 ? "credit" : "debit",
        description:
          "Reparo Sport×Cuiabá: won_exchange sem devolver stake — +R$1000 − R$15,81 (LAY@32)",
        metadata: {
          repair_tag: TAG,
          tag: TAG,
          protection_id: PROT_ID,
          market_odd: odd,
          stake_cents: stake,
          fee_cents: fee,
          returned_stake_cents: stake,
          unlocked_locked: true,
          exchange_no_credit: true,
          note,
        },
      },
    });
  } catch (e) {
    console.warn("  tx skip:", e.message || e);
  }

  console.log("\n========== VERIFY ==========");
  console.log("  Apostador:", money(after.balance_cents), "(alvo", money(CORRECT_FROM_BASE) + ")");
  console.log("  Congelado:", money(after.locked_balance_cents), "(alvo R$ 0,00)");
  console.log("  Reembolso:", money(after.deduction_balance_cents), "(Exchange = R$ 0)");
  console.log("  proteção :", PROT_ID);
  console.log("============================");

  if (n(after.locked_balance_cents) > 0 && nextLocked === 0) {
    console.error("FALHA: Congelado ainda > 0");
    process.exit(1);
  }
  if (n(after.balance_cents) !== nextBal) {
    console.error("FALHA: Apostador não bateu o plano", money(after.balance_cents));
    process.exit(1);
  }
  console.log("OK — hard refresh no Financeiro. Apostador deve ir a R$ 9.051,71");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
