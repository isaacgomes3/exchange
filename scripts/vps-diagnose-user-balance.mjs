#!/usr/bin/env node
/**
 * Diagnóstico de saldo de um usuário (VPS, com SERVICE_ROLE).
 *
 *   EMAIL=carloskku4@gmail.com node scripts/vps-diagnose-user-balance.mjs
 */
import fs from "node:fs";
import path from "node:path";

const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com")
  .trim()
  .toLowerCase();

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
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

async function sb(p) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${text.slice(0, 200)}`);
  return data;
}

async function findAuthUser(email) {
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      }
    );
    const data = await res.json();
    const users = data?.users || data || [];
    if (!Array.isArray(users) || !users.length) break;
    const hit = users.find(
      (u) => String(u.email || "").toLowerCase() === email
    );
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

async function main() {
  console.log("==> Diagnóstico saldo:", EMAIL);
  console.log("    SUPABASE_URL:", SUPABASE_URL);

  const auth = await findAuthUser(EMAIL);
  if (!auth) {
    console.error("Usuário não encontrado no Auth");
    process.exit(2);
  }
  const id = auth.id;
  console.log("    auth.id:", id);
  console.log("    confirmed:", !!auth.email_confirmed_at);
  console.log("    last_sign_in:", auth.last_sign_in_at || "—");

  const profiles = await sb(
    `/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const p = Array.isArray(profiles) ? profiles[0] : null;
  if (!p) {
    console.error("Sem row em profiles");
    process.exit(3);
  }

  const real = Number(p.balance_cents || 0) + Number(p.reusable_balance_cents || 0);
  const apostador =
    real + Number(p.demo_balance_cents || 0);
  const provedor =
    Number(p.investor_balance_cents || 0) +
    Number(p.demo_balance_provider_cents || 0);

  console.log("\n==> Buckets profiles");
  for (const k of [
    "balance_cents",
    "reusable_balance_cents",
    "demo_balance_cents",
    "investor_balance_cents",
    "demo_balance_provider_cents",
    "desafio_balance_cents",
    "locked_balance_cents",
    "debited_balance_cents",
    "total_profit_cents",
    "updated_at",
  ]) {
    const v = p[k];
    if (String(k).endsWith("_cents")) {
      console.log(`  ${k}: ${v} (${money(v)})`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }

  console.log("\n==> Como a UI soma");
  console.log(`  Saldo Real (carteira, sem demo): ${money(real)}`);
  console.log(`  Chip Apostador (shell = real+demo): ${money(apostador)}`);
  console.log(`  Provedor: ${money(provedor)}`);
  console.log(`  Desafio: ${money(p.desafio_balance_cents)}`);
  if (Number(p.demo_balance_cents || 0) > 0) {
    console.log(
      "  ⚠ demo_balance_cents > 0 — bug antigo fazia chip mudar no refresh da Carteira"
    );
  }

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,meta,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=30`
  );
  console.log("\n==> Últimas 30 wallet_transactions");
  for (const t of Array.isArray(txs) ? txs : []) {
    console.log(
      `  ${t.created_at}  ${String(t.type).padEnd(22)} ${money(t.amount_cents)}  ${JSON.stringify(t.meta || {}).slice(0, 80)}`
    );
  }

  const deps = await sb(
    `/rest/v1/manual_deposits?select=id,amount_cents,status,network,deposit_type,admin_notes,created_at,updated_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=20`
  );
  console.log("\n==> Últimos 20 manual_deposits");
  for (const d of Array.isArray(deps) ? deps : []) {
    console.log(
      `  ${d.created_at}  ${String(d.status).padEnd(14)} ${money(d.amount_cents)}  ${d.network || "—"}  ${d.deposit_type || ""}  ${(d.admin_notes || "").slice(0, 40)}`
    );
  }

  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,result,created_at,settled_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=20`
  );
  console.log("\n==> Últimas 20 protections");
  for (const r of Array.isArray(prots) ? prots : []) {
    console.log(
      `  ${r.created_at}  ${String(r.status).padEnd(14)} ${money(r.amount_cents)}  ${r.result || "—"}`
    );
  }

  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
