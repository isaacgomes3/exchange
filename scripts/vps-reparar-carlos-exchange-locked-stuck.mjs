#!/usr/bin/env node
/**
 * Reparo Carlos Roberto — locked preso após Exchange (print 27/07).
 *
 * Sintoma no Centro Financeiro:
 *   Apostador R$ 8.067,52 · Congelado R$ 1.000 · Proteções ativas 0
 *   (settle marcou a proteção, mas NÃO destravaou / NÃO devolveu / NÃO cobrou fees)
 *
 * Regra v7 (pedido explícito):
 *   Exchange → R$ 0 Reembolso · destrava e DEVOLVE stake ·
 *   cobra dedução (lucro−4,5%−1,5%) + comissão Exchange 4,5%
 *
 * Na VPS:
 *   node scripts/vps-reparar-carlos-exchange-locked-stuck.mjs           # dry-run
 *   FIX=1 node scripts/vps-reparar-carlos-exchange-locked-stuck.mjs     # aplica
 *
 * Overrides: USER_ID=... EMAIL=... NAME="Carlos Roberto"
 *            EXPECT_BALANCE_CENTS=806752 EXPECT_LOCKED_CENTS=100000
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com").trim().toLowerCase();
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const EXPECT_BALANCE_CENTS = Math.trunc(
  Number(process.env.EXPECT_BALANCE_CENTS || 806_752)
);
const EXPECT_LOCKED_CENTS = Math.trunc(
  Number(process.env.EXPECT_LOCKED_CENTS || 100_000)
);
const REPAIR_TAG = "repair-carlos-exchange-locked-stuck-v7";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
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

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente");
  process.exit(1);
}

function n(v) {
  return Math.max(0, Math.trunc(Number(v) || 0));
}
function money(c) {
  return (n(c) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function sb(p, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 500)}`);
  return data;
}

let calcLay;
let settlementDeductionCents;
let settlementExchangeCommissionCents;
try {
  const mod = await import(
    pathToFileURL(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "lib/protection-flow-contract.mjs"
      )
    ).href
  );
  calcLay = mod.calcLay;
  settlementDeductionCents = mod.settlementDeductionCents;
  settlementExchangeCommissionCents = mod.settlementExchangeCommissionCents;
} catch (e) {
  console.warn("[repair] contrato ausente — fallback inline:", e.message || e);
  calcLay = (amountCents, odd) => {
    const o = Number(odd) > 1.01 ? Number(odd) : 1.01;
    const back = o / (o - 1);
    const coverage = Math.floor(amountCents);
    const gross = Math.max(0, Math.round(coverage * back) - coverage);
    const commission = Math.round(gross * 0.045);
    const user = Math.round(coverage * 0.015);
    return {
      grossProfitCents: gross,
      exchangeCommissionCents: commission,
      userProfitCents: user,
      arbiShieldDeductionCents: Math.max(0, gross - commission - user),
    };
  };
  settlementDeductionCents = (row) => {
    const stake = n(row.responsibility_cents || row.amount_cents);
    const odd = Number(row.odd || row?.metadata?.market_odd || 0);
    if (!(stake > 0 && odd > 1.01)) return n(row.platform_deduction_cents);
    return calcLay(stake, odd).arbiShieldDeductionCents;
  };
  settlementExchangeCommissionCents = (row) => {
    const stake = n(row.responsibility_cents || row.amount_cents);
    const odd = Number(row.odd || row?.metadata?.market_odd || 0);
    if (!(stake > 0 && odd > 1.01)) return n(row.exchange_fee_cents);
    return calcLay(stake, odd).exchangeCommissionCents;
  };
}

async function findUser() {
  if (USER_ID_ENV) {
    const rows = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents&limit=1`
    );
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) throw new Error(`USER_ID não encontrado: ${USER_ID_ENV}`);
    return p;
  }
  // profiles.email não existe — busca por nome/saldo
  const rows = await sb(
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents&limit=20`
  );
  const list = Array.isArray(rows) ? rows : [];
  const hit =
    list.find(
      (p) =>
        n(p.balance_cents) === EXPECT_BALANCE_CENTS &&
        n(p.locked_balance_cents) === EXPECT_LOCKED_CENTS
    ) ||
    list.find((p) => n(p.locked_balance_cents) === EXPECT_LOCKED_CENTS) ||
    list.find((p) => String(p.full_name || "").toLowerCase().includes("carlos"));
  if (!hit) {
    throw new Error(
      `Não achei ${NAME} com balance=${EXPECT_BALANCE_CENTS} locked=${EXPECT_LOCKED_CENTS}`
    );
  }
  return hit;
}

async function loadCandidateProtection(userId) {
  const q =
    `user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,status,amount_cents,responsibility_cents,odd,platform_deduction_cents,exchange_fee_cents,settled_outcome,settled_at,created_at,metadata,match_id` +
    `&order=created_at.desc&limit=20`;
  const lay = await sb(`/rest/v1/protections?${q}`).catch(() => []);
  const back = await sb(`/rest/v1/back_protections?${q}`).catch(() => []);
  const all = [...(Array.isArray(lay) ? lay : []), ...(Array.isArray(back) ? back : [])]
    .map((r) => ({ ...r, _table: r.responsibility_cents != null ? "protections" : "back_protections" }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  // Prefer won_exchange / settled with stake ~ locked
  const byOutcome = all.find((r) => {
    const st = String(r.status || "").toLowerCase();
    const oc = String(r.settled_outcome || "").toLowerCase();
    const stake = n(r.responsibility_cents || r.amount_cents);
    return (
      stake === EXPECT_LOCKED_CENTS &&
      (oc === "exchange" || st === "won_exchange" || st === "settled")
    );
  });
  if (byOutcome) return byOutcome;

  // Active still holding the lock
  const active = all.find((r) => {
    const st = String(r.status || "").toLowerCase();
    const stake = n(r.responsibility_cents || r.amount_cents);
    return stake === EXPECT_LOCKED_CENTS && (st === "active" || st === "pending" || st === "review_odd");
  });
  if (active) return active;

  // Fallback: any recent with matching stake
  return all.find((r) => n(r.responsibility_cents || r.amount_cents) === EXPECT_LOCKED_CENTS) || null;
}

async function alreadyRepaired(protectionId) {
  if (!protectionId) return false;
  const rows = await sb(
    `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(protectionId)}&type=in.(protection_settlement,exchange_commission,protection_refund)&select=id,type,amount_cents,metadata&order=created_at.desc&limit=40`
  ).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  const tagged = list.some(
    (t) => t?.metadata && String(t.metadata.fix || "") === REPAIR_TAG
  );
  if (tagged) return true;
  // settle completo v7: stake_returned + fee cobrada
  const settle = list.find((t) => String(t.type) === "protection_settlement");
  const meta = settle?.metadata && typeof settle.metadata === "object" ? settle.metadata : {};
  return meta.stake_returned === true && n(meta.fee_charged_cents) > 0;
}

async function main() {
  console.log(FIX ? "=== FIX ON ===" : "=== DRY-RUN ===");
  const user = await findUser();
  console.log("User:", user.id, user.full_name || user.email || "");
  console.log(
    "Antes:",
    "Apostador",
    money(user.balance_cents),
    "| Locked",
    money(user.locked_balance_cents),
    "| Reembolso",
    money(user.deduction_balance_cents)
  );

  if (n(user.locked_balance_cents) <= 0) {
    console.log("OK — locked já zerado. Nada a fazer.");
    return;
  }

  const prot = await loadCandidateProtection(user.id);
  let stake = EXPECT_LOCKED_CENTS;
  let fee = 9111;
  let commission = 0;
  let protId = `orphan-locked:${user.id}`;
  let table = null;

  if (prot) {
    stake = n(prot.responsibility_cents || prot.amount_cents) || EXPECT_LOCKED_CENTS;
    fee = settlementDeductionCents(prot) || 9111;
    commission = 0; // v9: sem comissão extra na carteira
    protId = prot.id;
    table = prot._table === "back_protections" ? "back_protections" : "protections";
    console.log(
      "Proteção:",
      prot.id,
      "status=",
      prot.status,
      "outcome=",
      prot.settled_outcome || "—"
    );
  } else {
    console.warn(
      "AVISO: proteção não encontrada — aplico force com stake=locked e fee LAY@10 (91,11)"
    );
  }

  // Nunca cobrir mais do que o locked atual
  stake = Math.min(stake, n(user.locked_balance_cents));
  const totalFees = fee + commission;
  const targetBalance = n(user.balance_cents) + stake - totalFees;
  const targetLocked = Math.max(0, n(user.locked_balance_cents) - stake);

  console.log("Stake:", money(stake));
  console.log("Dedução ArbiShield:", money(fee));
  console.log("Comissão Exchange 4,5%:", money(commission));
  console.log("Alvo Apostador:", money(targetBalance), "| Locked:", money(targetLocked));

  if (prot && (await alreadyRepaired(prot.id))) {
    console.log("Já existe settle/repair com stake_returned — forço PATCH de locked mesmo assim.");
  }

  if (!FIX) {
    console.log("\nDry-run. Para aplicar:");
    console.log("  FIX=1 node scripts/vps-reparar-carlos-exchange-locked-stuck.mjs");
    console.log("Ou force direto:");
    console.log("  FIX=1 node scripts/vps-forcar-descongelar-carlos.mjs");
    return;
  }

  // 1) wallet patch — OBRIGATÓRIO zerar locked
  const patched = await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: targetBalance,
      locked_balance_cents: targetLocked,
      reusable_balance_cents: 0,
      updated_at: new Date().toISOString(),
    },
  });
  let row = Array.isArray(patched) ? patched[0] : patched;
  if (!row || n(row.locked_balance_cents) > 0) {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: { balance_cents: targetBalance, locked_balance_cents: 0 },
    });
  }

  // 2) txs audit
  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: user.id,
      type: "protection_settlement",
      amount_cents: -fee,
      ref: protId,
      metadata: {
        protection_id: protId,
        match_id: prot?.match_id || null,
        outcome: "exchange",
        stake_cents: stake,
        fee_cents: fee,
        fee_charged_cents: fee,
        exchange_commission_cents: commission,
        unlocked_locked: true,
        stake_returned: true,
        returned_stake_cents: stake,
        unlock_return_to_origin: true,
        fix: REPAIR_TAG,
        note: "Reparo v7: destrava+devolve stake; cobra dedução (Exchange stuck locked)",
      },
    },
  });
  if (commission > 0) {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: user.id,
        type: "exchange_commission",
        amount_cents: -commission,
        ref: protId,
        metadata: {
          protection_id: protId,
          outcome: "exchange",
          label: "Comissão Exchange (4,5% do lucro)",
          exchange_commission_cents: commission,
          fix: REPAIR_TAG,
          note: "Reparo v7 comissão Exchange",
        },
      },
    });
  }

  // 3) garante status won_exchange se ainda ativa
  if (prot && table) {
    const st = String(prot.status || "").toLowerCase();
    if (st === "active" || st === "pending" || st === "review_odd" || !st) {
      await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(prot.id)}`, {
        method: "PATCH",
        body: {
          status: "won_exchange",
          settled_outcome: "exchange",
          settled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }).catch((e) => console.warn("status patch:", e.message || e));
    }
  }

  const after = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=balance_cents,locked_balance_cents,deduction_balance_cents&limit=1`
  );
  const p2 = Array.isArray(after) ? after[0] : null;
  console.log(
    "Depois:",
    "Apostador",
    money(p2?.balance_cents),
    "| Locked",
    money(p2?.locked_balance_cents),
    "| Reembolso",
    money(p2?.deduction_balance_cents)
  );
  if (n(p2?.locked_balance_cents) > 0) {
    throw new Error("FALHOU: locked ainda > 0 após reparo");
  }
  console.log("OK — reparo aplicado (" + REPAIR_TAG + ")");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
