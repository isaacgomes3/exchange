#!/usr/bin/env node
/**
 * Crédito manual — Luiz Paulo — R$ 110,00
 * Obs: "ajuste de saldo apos auditoria"
 *
 * Relatório:
 *   node scripts/vps-credito-manual-luiz.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-credito-manual-luiz.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const ID_PREFIX = String(process.env.ID_PREFIX || "b6eb155d").trim().toLowerCase();
const AMOUNT_CENTS = Math.round(Number(process.env.AMOUNT_CENTS || 11000)); // R$ 110
const REASON = String(
  process.env.REASON || "ajuste de saldo apos auditoria"
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
if (!(AMOUNT_CENTS > 0)) {
  console.error("ERRO: AMOUNT_CENTS inválido");
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 240)}`);
  return data;
}

async function main() {
  console.log("==> Crédito manual");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    valor:", money(AMOUNT_CENTS));
  console.log("    motivo:", REASON);
  console.log("    id~", ID_PREFIX);

  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents&order=created_at.desc&limit=5000`
  );
  const list = (Array.isArray(rows) ? rows : []).filter((r) =>
    String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
  );
  if (!list.length) throw new Error(`sem profile id~${ID_PREFIX}`);
  if (list.length > 1) {
    console.log("Matches:");
    list.forEach((r) =>
      console.log(`  ${r.id}  ${r.full_name}  ${money(r.balance_cents)}`)
    );
  }
  const p = list[0];
  const before = n(p.balance_cents);
  const after = before + AMOUNT_CENTS;

  console.log("\n  user:", p.id);
  console.log("  nome:", p.full_name || "—");
  console.log("  status:", p.account_status || "—");
  console.log("  saldo:", money(before), "→", money(after));

  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-credito-manual-luiz.mjs");
    console.log("OK");
    return;
  }

  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: { balance_cents: after, updated_at: new Date().toISOString() },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: { balance_cents: after },
    });
  }

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: AMOUNT_CENTS,
      balance_before_cents: before,
      balance_after_cents: after,
      metadata: {
        reason: REASON,
        source: "admin_manual_vps",
        fix: "vps-credito-manual-luiz-v1",
      },
    },
  });

  console.log("\n  OK creditado", money(AMOUNT_CENTS), "→ saldo", money(after));
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
