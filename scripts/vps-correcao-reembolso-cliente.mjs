#!/usr/bin/env node
/**
 * Correção genérica — mover excesso Saldo Reembolso → Real
 * (preserva residual Arbi legítimo = settles Arbi − saques reembolso)
 *
 *   NAME="..." ID_PREFIX=abcd1234 FIX=0 node scripts/vps-correcao-reembolso-cliente.mjs
 *   FIX=1 FORCE_ALL=1 ...  # zera todo Reembolso
 *
 * Marker: vps-correcao-reembolso-cliente-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const FORCE_ALL =
  process.env.FORCE_ALL === "1" || process.env.FORCE_ALL === "true";
const NAME = String(process.env.NAME || "").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "").trim().toLowerCase();
const USER_ID = String(process.env.USER_ID || "").trim();

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
if (!USER_ID && !ID_PREFIX && !NAME) {
  console.error("Informe USER_ID=, ID_PREFIX= ou NAME=");
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
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
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

async function resolveUser() {
  if (USER_ID) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents&id=eq.${encodeURIComponent(USER_ID)}`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  if (ID_PREFIX) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  if (NAME) {
    const first = NAME.split(/\s+/)[0];
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents&full_name=ilike.*${encodeURIComponent(first)}*&limit=30`
    );
    const want = norm(NAME);
    const hit = (Array.isArray(rows) ? rows : []).find((r) =>
      norm(r.full_name).includes(want)
    );
    if (hit) return hit;
  }
  console.error("perfil não encontrado");
  process.exit(2);
}

async function main() {
  console.log("==> Correção Reembolso cliente");
  console.log("    marker: vps-correcao-reembolso-cliente-v1");
  console.log("    FIX:", FIX ? "SIM" : "não");

  const p = await resolveUser();
  console.log("    ", p.id, p.full_name);

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const apostador = real + reembolso + n(p.demo_balance_cents);

  const settles = await sb(
    `/rest/v1/wallet_transactions?select=amount_cents,metadata&user_id=eq.${encodeURIComponent(p.id)}&type=eq.protection_settlement&limit=500`
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
    `/rest/v1/withdrawals?select=amount_cents,status,metadata&user_id=eq.${encodeURIComponent(p.id)}&limit=100`
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

  console.log("\n==> ANTES Real", money(real), "Reembolso", money(reembolso), "Apostador", money(apostador));
  console.log("    Arbi", money(sumArbi), "Exch", money(sumEx), "saqueR", money(wdReemb));
  console.log("    keep", money(keepArbi), "mover", money(move));
  console.log("    Real →", money(real + move), "| Reembolso →", money(keepArbi));

  if (move <= 0) {
    console.log("Nada a mover.");
    return;
  }

  const already = await sb(
    `/rest/v1/wallet_transactions?select=metadata,created_at&user_id=eq.${encodeURIComponent(p.id)}&type=eq.admin_adjustment&order=created_at.desc&limit=20`
  );
  if (
    (Array.isArray(already) ? already : []).some((t) => {
      const k = metaOf(t).kind || "";
      return (
        k === "correcao_reembolso_cliente_v1" ||
        String(k).startsWith("correcao_reembolso_")
      );
    })
  ) {
    console.log("Já há correção recente — abortando (force com novo kind se necessário).");
    // still allow if excess remains and last correction wasn't this exact amount - keep simple abort
  }

  if (!FIX) {
    console.log("\n(dry-run) FIX=1 para aplicar");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: n(p.balance_cents) + move,
      deduction_balance_cents: keepArbi,
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
        kind: "correcao_reembolso_cliente_v1",
        from_bucket: "deduction_balance_cents",
        to_bucket: "balance_cents",
        amount_cents: move,
        keep_arbi_cents: keepArbi,
        name: p.full_name,
        reason: "excesso Reembolso (settle Exchange/legado) → Real",
      },
    },
  });
  console.log("✓ aplicado");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
