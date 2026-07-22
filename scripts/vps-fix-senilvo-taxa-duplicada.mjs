#!/usr/bin/env node
/**
 * Senilvo — taxa Exchange debitada em dobro (188,37 em vez de 194,38).
 * Credita R$ 6,01 de volta.
 *
 *   FIX=1 node scripts/vps-fix-senilvo-taxa-duplicada.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(process.env.NAME || "SENILVO ACRI CARVALHO").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "8839add0").trim().toLowerCase();
const CREDIT_CENTS = Math.round(Number(process.env.CREDIT_CENTS || 601));
const TARGET_REAL_CENTS = Math.round(Number(process.env.TARGET_REAL_CENTS || 19438));

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

async function main() {
  console.log("==> Senilvo — desfazer taxa duplicada (+R$ 6,01)");
  console.log("    alvo real:", money(TARGET_REAL_CENTS));
  console.log("    FIX:", FIX ? "SIM" : "não");

  let user = null;
  if (ID_PREFIX) {
    const all = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents&order=created_at.desc&limit=5000`
    );
    user = (Array.isArray(all) ? all : []).find((r) =>
      String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
    );
  }
  if (!user) {
    const q = encodeURIComponent("%" + NAME + "%");
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents&full_name=ilike.${q}&limit=5`
    );
    user = Array.isArray(rows) ? rows[0] : null;
  }
  if (!user) throw new Error("Senilvo não encontrado");

  const bal = n(user.balance_cents) + n(user.reusable_balance_cents);
  const gap = TARGET_REAL_CENTS - bal;
  const credit = gap > 0 ? gap : CREDIT_CENTS;

  console.log("\n  user:", user.id);
  console.log("  nome:", user.full_name);
  console.log("  real agora:", money(user.balance_cents));
  console.log("  reutil:", money(user.reusable_balance_cents));
  console.log("  locked:", money(user.locked_balance_cents));
  console.log("  gap até alvo:", money(gap), gap === CREDIT_CENTS ? "(taxa duplicada)" : "");

  if (gap === 0) {
    console.log("\n  Já está no alvo", money(TARGET_REAL_CENTS));
    console.log("OK");
    return;
  }
  if (gap < 0) {
    console.log(
      "\n  ⚠ saldo já está ACIMA do alvo — não credita automático. Ajuste TARGET_REAL_CENTS se necessário."
    );
    console.log("OK");
    return;
  }

  if (!FIX) {
    console.log("\n  Para creditar", money(credit), "→", money(bal + credit));
    console.log("  FIX=1 node scripts/vps-fix-senilvo-taxa-duplicada.mjs");
    console.log("OK");
    return;
  }

  const nextBal = n(user.balance_cents) + credit;
  const nextReusable = 0;
  // Se ainda houver reusable, consolida no real junto
  const consolidated = nextBal + n(user.reusable_balance_cents);

  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: consolidated,
        reusable_balance_cents: nextReusable,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: consolidated,
        reusable_balance_cents: nextReusable,
      },
    });
  }

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: user.id,
      type: "admin_adjustment",
      amount_cents: credit,
      metadata: {
        reason: "estorno taxa Exchange debitada em dobro (alvo R$ 194,38)",
        before_real_cents: bal,
        after_real_cents: consolidated,
        target_real_cents: TARGET_REAL_CENTS,
        fix: "vps-fix-senilvo-taxa-duplicada-v1",
      },
    },
  });

  const refreshed = await sb(
    `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(user.id)}&limit=1`
  );
  const p2 = Array.isArray(refreshed) ? refreshed[0] : null;
  console.log("\n==> Saldo final");
  console.log("  real:", money(p2?.balance_cents));
  console.log("  reutil:", money(p2?.reusable_balance_cents));
  console.log("  locked:", money(p2?.locked_balance_cents));
  console.log("OK");
}

main().catch((e) => {
  console.error("FALHA:", e.message || e);
  process.exit(1);
});
