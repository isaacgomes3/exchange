#!/usr/bin/env node
/**
 * Diagnostica proteção (ex.: 4dc699ed…) e, com FIX=1, cobra a dedução
 * fee_upfront se ainda não foi debitada.
 *
 * Na VPS:
 *   node /opt/arbishield/scripts/vps-sandbox-diagnosticar-protecao.mjs 4dc699ed
 *   FIX=1 node /opt/arbishield/scripts/vps-sandbox-diagnosticar-protecao.mjs 4dc699ed
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const PREFIX = String(process.argv[2] || process.env.PROTECTION_ID || "")
  .trim()
  .toLowerCase();

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
if (PREFIX.length < 6) {
  console.error("Uso: node vps-sandbox-diagnosticar-protecao.mjs <id-prefix>");
  process.exit(1);
}

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  return Number(v || 0);
}

function calcFeeUpfront(amountCents, odd) {
  const stake =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const grossProfitCents = Math.max(0, Math.round(stake * o) - stake);
  const userProfitCents = Math.round(stake * 0.015);
  return Math.max(0, grossProfitCents - userProfitCents);
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 300)}`);
  return data;
}

async function findProtection() {
  for (const table of ["protections", "back_protections"]) {
    const rows = await sb(
      `/rest/v1/${table}?select=*&order=created_at.desc&limit=80`
    );
    const hit = (Array.isArray(rows) ? rows : []).find((r) =>
      String(r.id || "")
        .toLowerCase()
        .startsWith(PREFIX)
    );
    if (hit) return { table, row: hit };
  }
  return null;
}

async function main() {
  console.log("==> Diagnóstico proteção", PREFIX, FIX ? "(FIX=1)" : "(somente leitura)");
  const found = await findProtection();
  if (!found) {
    console.error("Proteção não encontrada com prefixo", PREFIX);
    process.exit(1);
  }
  const { table, row } = found;
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const stake = n(row.amount_cents || row.responsibility_cents || meta.stake_cents);
  const odd = n(row.odd || meta.market_odd);
  const feeExpected = calcFeeUpfront(stake, odd);
  const feeRecorded = n(
    meta.fee_charged_cents ?? row.platform_deduction_cents ?? row.platform_profit_cents
  );
  const billing = String(meta.billing_model || meta.source || "legado/desconhecido");

  const profiles = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}&select=id,balance_cents,reusable_balance_cents,demo_balance_cents,desafio_balance_cents,locked_balance_cents,investor_balance_cents&limit=1`
  );
  const p = Array.isArray(profiles) ? profiles[0] : null;

  console.log("  table:", table);
  console.log("  id:", row.id);
  console.log("  status:", row.status);
  console.log("  stake:", money(stake), "· odd:", odd);
  console.log("  billing:", billing);
  console.log("  fee gravada:", money(feeRecorded));
  console.log("  fee esperada (fee_upfront):", money(feeExpected));
  console.log("  balance_before/after:", money(row.balance_before_cents), "→", money(row.balance_after_cents));
  if (p) {
    console.log("  perfil DEMO:", money(p.demo_balance_cents));
    console.log(
      "  perfil REAL:",
      money(n(p.balance_cents) + n(p.reusable_balance_cents))
    );
    console.log("  perfil DESAFIO:", money(p.desafio_balance_cents));
    console.log("  perfil LOCKED:", money(p.locked_balance_cents));
  }

  const alreadyFee =
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront");
  const debitLooksApplied =
    alreadyFee &&
    feeRecorded > 0 &&
    n(row.balance_before_cents) - n(row.balance_after_cents) === feeRecorded;

  if (debitLooksApplied) {
    console.log("\nOK — dedução fee_upfront já parece aplicada.");
    return;
  }

  console.log("\n!! Dedução fee_upfront NÃO confirmada no saldo.");

  if (!FIX) {
    console.log("Rode com FIX=1 para cobrar agora a dedução esperada no DEMO (ou REAL se DEMO=0).");
    process.exit(2);
  }

  if (!p) throw new Error("perfil ausente");
  const fee = feeExpected > 0 ? feeExpected : feeRecorded;
  if (!(fee > 0)) throw new Error("fee calculada zerada — abortado");

  let wallet = "DEMO";
  let available = n(p.demo_balance_cents);
  if (available < fee) {
    wallet = "REAL";
    available = n(p.balance_cents) + n(p.reusable_balance_cents);
  }
  if (available < fee) {
    throw new Error(
      `Saldo insuficiente para cobrar ${money(fee)} (DEMO/REAL).`
    );
  }

  const patch = { updated_at: new Date().toISOString() };
  let balanceAfter = 0;
  if (wallet === "DEMO") {
    patch.demo_balance_cents = n(p.demo_balance_cents) - fee;
    balanceAfter = patch.demo_balance_cents;
  } else {
    const bal = n(p.balance_cents) + n(p.reusable_balance_cents);
    patch.balance_cents = bal - fee;
    patch.reusable_balance_cents = 0;
    balanceAfter = bal - fee;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
    method: "PATCH",
    body: patch,
  });

  const newMeta = {
    ...meta,
    billing_model: "fee_upfront_v1",
    fee_upfront: true,
    fee_charged_cents: fee,
    fee_charged_retroactive: true,
    fee_charged_at: new Date().toISOString(),
    source: meta.source || "v2_create_protection_fee_upfront",
  };

  await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    body: {
      platform_deduction_cents: fee,
      platform_profit_cents: fee,
      user_profit_cents: Math.round(stake * 0.015),
      balance_before_cents: available,
      balance_after_cents: balanceAfter,
      locked_deduction_cents: 0,
      metadata: newMeta,
    },
  });

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: row.user_id,
      type: "protection_fee",
      amount_cents: -fee,
      balance_before_cents: available,
      balance_after_cents: balanceAfter,
      ref: row.id,
      metadata: {
        protection_id: row.id,
        billing_model: "fee_upfront_v1",
        retroactive: true,
        balance_type: wallet,
        fee_cents: fee,
        stake_cents: stake,
      },
    },
  }).catch((e) => console.warn("wallet_transactions:", e.message || e));

  console.log("\nOK — cobrado", money(fee), "de", wallet);
  console.log("  saldo após:", money(balanceAfter));
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
