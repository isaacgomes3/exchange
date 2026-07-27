#!/usr/bin/env node
/**
 * Correção Pedro Iuri — residual Saldo Reembolso (padrão Lucas/Augusto).
 *
 * MOVE Reembolso → Real (net Apostador igual), sem apagar dinheiro.
 * Se existir residual Arbi legítimo (settle Arbi − saques), preserva.
 *
 * Marker: vps-correcao-reembolso-pedro-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf")
  .trim()
  .toLowerCase();
const USER_ID = String(process.env.USER_ID || "").trim();
const NAME = String(
  process.env.NAME || "Pedro Iuri Teixeira dos Santos"
).trim();
const FORCE_ALL =
  process.env.FORCE_ALL === "1" || process.env.FORCE_ALL === "true";

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
  console.log("==> Correção Reembolso Pedro Iuri");
  console.log("    marker: vps-correcao-reembolso-pedro-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    FORCE_ALL:", FORCE_ALL ? "SIM (zera todo Reembolso)" : "não (preserva Arbi legítimo)");

  let uid = USER_ID;
  if (!uid) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    if (!Array.isArray(rows) || !rows[0]) {
      console.error("perfil não encontrado");
      process.exit(2);
    }
    uid = rows[0].id;
  }

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents&id=eq.${encodeURIComponent(uid)}`
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

  const already = await sb(
    `/rest/v1/wallet_transactions?select=id,created_at,metadata&user_id=eq.${encodeURIComponent(uid)}&type=eq.admin_adjustment&order=created_at.desc&limit=30`
  );
  if (
    (Array.isArray(already) ? already : []).some(
      (t) => metaOf(t).kind === "correcao_reembolso_pedro_v1"
    )
  ) {
    console.log("\n✓ Correção já aplicada. Abortando.");
    return;
  }

  const settles = await sb(
    `/rest/v1/wallet_transactions?select=amount_cents,metadata&user_id=eq.${encodeURIComponent(uid)}&type=eq.protection_settlement&limit=300`
  );
  let sumArbi = 0;
  let sumEx = 0;
  for (const t of Array.isArray(settles) ? settles : []) {
    if (n(t.amount_cents) <= 0) continue;
    const o = String(metaOf(t).outcome || "").toLowerCase();
    if (o === "arbishield" || o === "lost_exchange") sumArbi += n(t.amount_cents);
    else if (o === "exchange" || o === "won_exchange") sumEx += n(t.amount_cents);
  }

  const wds = await sb(
    `/rest/v1/withdrawals?select=amount_cents,status,metadata&user_id=eq.${encodeURIComponent(uid)}&limit=50`
  );
  let wdReemb = 0;
  for (const w of Array.isArray(wds) ? wds : []) {
    const st = String(w.status || "").toLowerCase();
    if (["rejected", "cancelled", "canceled"].includes(st)) continue;
    const origin = String(metaOf(w).origin || metaOf(w).label || "").toUpperCase();
    if (
      origin.includes("REEMBOLSO") ||
      origin.includes("DEDUCTION") ||
      origin.includes("DEDUCAO")
    ) {
      wdReemb += n(w.amount_cents);
    }
  }

  const keepArbi = FORCE_ALL ? 0 : Math.max(0, sumArbi - wdReemb);
  const move = Math.max(0, reembolso - keepArbi);

  console.log("\n==> Contas");
  console.log("    settles Arbi hist :", money(sumArbi));
  console.log("    settles Exch hist :", money(sumEx));
  console.log("    saques Reembolso  :", money(wdReemb));
  console.log("    preservar Arbi    :", money(keepArbi));
  console.log("    mover → Real      :", money(move));

  if (move <= 0) {
    console.log("\nNada a mover (Reembolso = residual Arbi legítimo ou já zerado).");
    return;
  }

  const newDed = keepArbi;
  const newBal = n(p.balance_cents) + move;
  const newReal = real + move; // Real = balance + reusable; só balance sobe

  console.log("\n==> PLANO");
  console.log("    Real     :", money(real), "→", money(newReal));
  console.log("    Reembolso:", money(reembolso), "→", money(newDed));
  console.log("    Apostador:", money(apostador), "→", money(newReal + newDed + n(p.demo_balance_cents)), "(igual)");

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
        kind: "correcao_reembolso_pedro_v1",
        from_bucket: "deduction_balance_cents",
        to_bucket: "balance_cents",
        amount_cents: move,
        keep_arbi_cents: keepArbi,
        reason:
          "Pedro Iuri: mesmo bug Lucas/Augusto — crédito Exchange/legado no Saldo Reembolso; mover excesso → Real",
        name: NAME,
        settle_arbi_cents: sumArbi,
        settle_exchange_cents: sumEx,
      },
    },
  });

  console.log("\n==> ✓ APLICADO");
  console.log("    Reembolso →", money(newDed));
  console.log("    movido para Real:", money(move));
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
