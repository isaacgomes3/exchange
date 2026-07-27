#!/usr/bin/env node
/**
 * Correção Augusto — Saldo Reembolso residual (mesmo raciocínio Lucas).
 *
 * Fatos:
 *   - Settle Arbi +R$ 255,51 e saque −R$ 255,51 já se anulam (saque incluso)
 *   - Reembolso atual R$ 45,17 NÃO é esse settle (já saiu no saque)
 *   - Ledger tem ~R$ 3.765 de settles Exchange (PERDEU) — bucket errado / legado
 *   - R$ 45,17 residual no Reembolso → mover para Real (net Apostador igual)
 *
 * Relatório: node scripts/vps-correcao-reembolso-augusto.mjs
 * Aplicar:   FIX=1 node scripts/vps-correcao-reembolso-augusto.mjs
 *
 * Marker: vps-correcao-reembolso-augusto-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const ID_PREFIX = String(process.env.ID_PREFIX || "8b2cd8a3")
  .trim()
  .toLowerCase();
const USER_ID = String(process.env.USER_ID || "").trim();
const NAME = String(
  process.env.NAME || "Augusto Luiz Magalhaes Vila Nova"
).trim();

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

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  return Number(v || 0);
}
function metaOf(row) {
  const m = row && row.metadata;
  if (!m) return {};
  if (typeof m === "string") {
    try {
      return JSON.parse(m) || {};
    } catch {
      return {};
    }
  }
  return typeof m === "object" && m ? m : {};
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  return data;
}

async function main() {
  console.log("==> Correção Reembolso Augusto");
  console.log("    marker: vps-correcao-reembolso-augusto-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");

  let uid = USER_ID;
  if (!uid) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    const p0 = Array.isArray(rows) && rows[0];
    if (!p0) {
      console.error("perfil não encontrado");
      process.exit(2);
    }
    uid = p0.id;
  }

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents&id=eq.${encodeURIComponent(uid)}`
  );
  const p = Array.isArray(profiles) && profiles[0];
  console.log("    ", p.id, p.full_name);

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const apostador = real + reembolso + n(p.demo_balance_cents);

  console.log("\n==> ANTES");
  console.log("    Real     :", money(real));
  console.log("    Reembolso:", money(reembolso));
  console.log("    Apostador:", money(apostador));
  console.log("    Desafio  :", money(p.desafio_balance_cents));

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=100`
  );
  const allTx = Array.isArray(txs) ? txs : [];

  const already = allTx.find((t) => {
    const m = metaOf(t);
    return m.kind === "correcao_reembolso_augusto_v1";
  });
  if (already) {
    console.log("\n✓ Correção já aplicada:", already.created_at);
    return;
  }

  let settleEx = 0;
  let settleArbi = 0;
  for (const t of allTx) {
    // only last 100 - also fetch all settlements
  }
  const settles = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&type=eq.protection_settlement&order=created_at.desc&limit=200`
  );
  for (const t of Array.isArray(settles) ? settles : []) {
    if (n(t.amount_cents) <= 0) continue;
    const o = String(metaOf(t).outcome || "").toLowerCase();
    if (o === "exchange" || o === "won_exchange") settleEx += n(t.amount_cents);
    else if (o === "arbishield" || o === "lost_exchange") settleArbi += n(t.amount_cents);
    else {
      // unknown — count as exchange-ish if no outcome
      settleEx += n(t.amount_cents);
    }
  }

  console.log("\n==> Contexto (saque já incluso no ledger)");
  console.log("    settles Exchange (histórico):", money(settleEx));
  console.log("    settles Arbi (histórico)    :", money(settleArbi));
  console.log("    Reembolso agora             :", money(reembolso));
  console.log("    → Arbi 255,51 − saque 255,51 = 0; residual Reembolso = legado/Exchange");

  if (reembolso <= 0) {
    console.log("\n✓ Reembolso já zerado. Nada a mover.");
    return;
  }

  const move = reembolso;
  const newDed = 0;
  const newBal = n(p.balance_cents) + move;

  console.log("\n==> PLANO (mover Reembolso → Real, net Apostador igual)");
  console.log("    mover                :", money(move));
  console.log("    Real depois          :", money(real - n(p.reusable_balance_cents) + newBal));
  console.log("    Reembolso depois     :", money(newDed));
  console.log("    Apostador depois     :", money(apostador), "(igual)");

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para aplicar.");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: newBal,
      deduction_balance_cents: newDed,
      updated_at: new Date().toISOString(),
    },
  });

  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: 0,
      ref: p.id,
      metadata: {
        kind: "correcao_reembolso_augusto_v1",
        from_bucket: "deduction_balance_cents",
        to_bucket: "balance_cents",
        amount_cents: move,
        reason:
          "Augusto: residual Reembolso após Arbi+saque (255,51) — mover para Real (créditos Exchange/legado no bucket errado)",
        name: NAME,
        settle_exchange_hist_cents: settleEx,
        settle_arbi_hist_cents: settleArbi,
      },
    },
  });

  console.log("\n==> ✓ APLICADO");
  console.log("    Real     :", money(real), "→", money(n(p.reusable_balance_cents) + newBal));
  console.log("    Reembolso:", money(reembolso), "→ R$ 0,00");
  console.log("    Apostador:", money(apostador), "(inalterado)");
  console.log("    Hard refresh em /app-carteira.html");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
