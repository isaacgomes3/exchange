#!/usr/bin/env node
/**
 * Crédito manual — Saldo Reembolso (deduction_balance_cents)
 * DIEGO HENRIQUE BARBOSA DOS SANTOS — R$ 250,00
 *
 * Relatório:
 *   node scripts/vps-credito-reembolso-diego.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-credito-reembolso-diego.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(
  process.env.NAME || "DIEGO HENRIQUE BARBOSA DOS SANTOS"
).trim();
const AMOUNT_CENTS = Math.round(Number(process.env.AMOUNT_CENTS || 25000)); // R$ 250
const REASON = String(
  process.env.REASON || "crédito manual Saldo Reembolso (admin)"
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 240)}`);
  return data;
}

async function main() {
  console.log("==> Crédito Saldo Reembolso");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    valor:", money(AMOUNT_CENTS));
  console.log("    motivo:", REASON);
  console.log("    nome:", NAME);

  const want = norm(NAME);
  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,deduction_balance_cents,demo_balance_cents&full_name=ilike.*${encodeURIComponent(NAME.split(/\s+/)[0])}*&order=created_at.desc&limit=200`
  );
  const list = (Array.isArray(rows) ? rows : []).filter((r) => {
    const nme = norm(r.full_name);
    return nme === want || nme.includes(want) || want.includes(nme);
  });

  if (!list.length) {
    // fallback: busca mais ampla por DIEGO HENRIQUE
    const wide = await sb(
      `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,deduction_balance_cents,demo_balance_cents&full_name=ilike.*DIEGO%20HENRIQUE*&order=created_at.desc&limit=50`
    );
    const candidates = Array.isArray(wide) ? wide : [];
    console.log("Sem match exato. Candidatos DIEGO HENRIQUE:");
    candidates.forEach((r) =>
      console.log(
        `  ${r.id}  ${r.full_name}  reembolso=${money(r.deduction_balance_cents)}`
      )
    );
    throw new Error(`perfil não encontrado: ${NAME}`);
  }

  if (list.length > 1) {
    console.log("Vários matches — usando o primeiro com nome mais longo/igual:");
    list.forEach((r) =>
      console.log(
        `  ${r.id}  ${r.full_name}  reembolso=${money(r.deduction_balance_cents)}`
      )
    );
  }

  list.sort(
    (a, b) =>
      Number(norm(b.full_name) === want) - Number(norm(a.full_name) === want) ||
      String(b.full_name || "").length - String(a.full_name || "").length
  );
  const p = list[0];
  const before = n(p.deduction_balance_cents);
  const after = before + AMOUNT_CENTS;

  console.log("\n  user:", p.id);
  console.log("  nome:", p.full_name || "—");
  console.log("  status:", p.account_status || "—");
  console.log("  Saldo Reembolso:", money(before), "→", money(after));
  console.log("  Apostador (real):", money(p.balance_cents));

  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-credito-reembolso-diego.mjs");
    console.log("OK");
    return;
  }

  // Idempotência: não repetir o mesmo crédito nos últimos 10 min
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  try {
    const recent = await sb(
      `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(p.id)}` +
        `&type=eq.admin_adjustment&amount_cents=eq.${AMOUNT_CENTS}` +
        `&created_at=gte.${encodeURIComponent(since)}` +
        `&select=id,metadata,created_at&order=created_at.desc&limit=5`
    );
    const dup = (Array.isArray(recent) ? recent : []).find((t) => {
      const m = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
      return (
        m.bucket === "deduction_balance_cents" &&
        m.fix === "vps-credito-reembolso-diego-v1"
      );
    });
    if (dup) {
      console.log("\n  Já creditado recentemente (tx", dup.id, ") — abortando.");
      console.log("OK");
      return;
    }
  } catch (e) {
    console.warn("  aviso idempotência:", e.message || e);
  }

  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        deduction_balance_cents: after,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: { deduction_balance_cents: after },
    });
  }

  const verify = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}&select=id,deduction_balance_cents&limit=1`
  );
  const got = n(Array.isArray(verify) ? verify[0]?.deduction_balance_cents : 0);
  if (got !== after) {
    throw new Error(
      `Falha ao gravar Saldo Reembolso: esperado ${after}, veio ${got}`
    );
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
        bucket: "deduction_balance_cents",
        label: "Saldo Reembolso",
        fix: "vps-credito-reembolso-diego-v1",
        full_name: p.full_name || NAME,
      },
    },
  });

  console.log(
    "\n  OK creditado",
    money(AMOUNT_CENTS),
    "→ Saldo Reembolso",
    money(after)
  );
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
