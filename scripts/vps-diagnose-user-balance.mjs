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
function n(v) {
  return Number(v || 0);
}

async function sb(p, { okNull = false } = {}) {
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
  if (!res.ok) {
    if (okNull) return null;
    throw new Error(`${res.status} ${p}: ${text.slice(0, 240)}`);
  }
  return data;
}

async function sbTry(paths) {
  let last = null;
  for (const p of paths) {
    try {
      return await sb(p);
    } catch (e) {
      last = e;
    }
  }
  if (last) throw last;
  return null;
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

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const apostador = real + n(p.demo_balance_cents);
  const provedor =
    n(p.investor_balance_cents) + n(p.demo_balance_provider_cents);

  console.log("\n==> Buckets profiles");
  for (const k of [
    "full_name",
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
  console.log(`  Desafio (chip separado): ${money(p.desafio_balance_cents)}`);
  console.log(
    `  Home "Evolução hoje" (apostador+provedor): ${money(apostador + provedor)}`
  );
  if (n(p.demo_balance_cents) > 0) {
    console.log(
      "  ⚠ demo_balance_cents > 0 — bug antigo fazia chip mudar no refresh da Carteira"
    );
  } else {
    console.log(
      "  demo=0 → bug do chip demo NÃO explica inconsistência desta conta"
    );
  }
  if (n(p.desafio_balance_cents) > 0) {
    console.log(
      "  ⚠ Tem saldo Desafio separado — não entra no chip Apostador; confusão comum ao comparar números"
    );
  }

  // Proteções ativas (locked implícito)
  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,result,created_at,settled_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`
  );
  const protRows = Array.isArray(prots) ? prots : [];
  const active = protRows.filter(
    (r) => String(r.status || "").toLowerCase() === "active"
  );
  const activeLocked = active.reduce(
    (a, r) => a + n(r.responsibility_cents || r.amount_cents),
    0
  );
  console.log("\n==> Proteções");
  console.log(`  total listadas (100): ${protRows.length}`);
  console.log(`  ativas: ${active.length} · capital ativo: ${money(activeLocked)}`);
  console.log(
    `  Carteira "Saldo Total" (real+prov+aff+locked): ~${money(real + provedor + activeLocked)} (aff não calculado aqui)`
  );
  console.log("  últimas 15:");
  for (const r of protRows.slice(0, 15)) {
    console.log(
      `    ${r.created_at}  ${String(r.status).padEnd(14)} ${money(r.amount_cents)}  ${r.result || "—"}`
    );
  }

  // Depósitos
  const deps = await sb(
    `/rest/v1/manual_deposits?select=id,amount_cents,status,network,deposit_type,admin_notes,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=20`
  );
  console.log("\n==> Últimos 20 manual_deposits");
  let approvedSum = 0;
  for (const d of Array.isArray(deps) ? deps : []) {
    if (String(d.status || "").toUpperCase() === "APPROVED") {
      approvedSum += n(d.amount_cents);
    }
    console.log(
      `  ${d.created_at}  ${String(d.status).padEnd(14)} ${money(d.amount_cents)}  ${d.network || "—"}  ${d.deposit_type || ""}`
    );
  }
  console.log(`  soma APPROVED (amostra 20): ${money(approvedSum)}`);

  // wallet_transactions — schema usa metadata (não meta)
  console.log("\n==> Últimas 30 wallet_transactions");
  try {
    const txs = await sbTry([
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=30`,
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=30`,
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=30`,
    ]);
    for (const t of Array.isArray(txs) ? txs : []) {
      const extra = t.metadata != null ? JSON.stringify(t.metadata).slice(0, 70) : t.ref || "";
      console.log(
        `  ${t.created_at}  ${String(t.type || "").padEnd(22)} ${money(t.amount_cents)}  ${extra}`
      );
    }
  } catch (e) {
    console.log("  falhou:", e.message || e);
  }

  console.log("\n==> unified_wallet_transactions (se existir)");
  try {
    const utx = await sb(
      `/rest/v1/unified_wallet_transactions?select=*&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=15`
    );
    for (const t of Array.isArray(utx) ? utx : []) {
      console.log(
        `  ${t.created_at || t.ts}  ${String(t.type || t.category || "").padEnd(18)} ${money(t.amount_cents || t.value_cents)}`
      );
    }
    if (!Array.isArray(utx) || !utx.length) console.log("  (vazio)");
  } catch (e) {
    console.log("  indisponível:", String(e.message || e).slice(0, 120));
  }

  console.log("\n==> Hipóteses se o usuário ainda vê número diferente no refresh");
  console.log("  1) Comparando chip Apostador com card Saldo Total (inclui locked/aff)");
  console.log("  2) Comparando Apostador com Desafio (chips separados)");
  console.log("  3) Cache do navegador — pedir Ctrl+Shift+R após hotfix do header");
  console.log("  4) Página antiga / legado vs /app.html");
  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
