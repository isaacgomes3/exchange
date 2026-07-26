#!/usr/bin/env node
/**
 * Migra TODO o reusable_balance_cents → balance_cents (política: só saldo real).
 *
 * Relatório:
 *   node scripts/vps-migrar-reusable-para-real-todos.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-migrar-reusable-para-real-todos.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";

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
  console.log("==> Migrar reusable → saldo real (todos)");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");

  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents&reusable_balance_cents=gt.0&order=reusable_balance_cents.desc&limit=5000`
  );
  const list = Array.isArray(rows) ? rows : [];
  console.log("  perfis com reusable > 0:", list.length);

  let total = 0;
  for (const p of list) {
    const re = n(p.reusable_balance_cents);
    total += re;
    console.log(
      `  ${String(p.id).slice(0, 8)}  ${(p.full_name || "—").slice(0, 40)}  real=${money(p.balance_cents)}  reutil=${money(re)}  → ${money(n(p.balance_cents) + re)}`
    );
  }
  console.log("\n  total a consolidar:", money(total));

  if (!list.length) {
    console.log("OK — ninguém com reusable");
    return;
  }
  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-migrar-reusable-para-real-todos.mjs");
    console.log("OK");
    return;
  }

  let ok = 0;
  for (const p of list) {
    const re = n(p.reusable_balance_cents);
    if (!(re > 0)) continue;
    const nextBal = n(p.balance_cents) + re;
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        body: {
          balance_cents: nextBal,
          reusable_balance_cents: 0,
          updated_at: new Date().toISOString(),
        },
      });
    } catch {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        body: {
          balance_cents: nextBal,
          reusable_balance_cents: 0,
        },
      });
    }
    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        body: {
          user_id: p.id,
          type: "admin_adjustment",
          amount_cents: re,
          metadata: {
            reason: "migração reusable→real (política: só saldo real)",
            from_bucket: "reusable_balance_cents",
            to_bucket: "balance_cents",
            fix: "migrar-reusable-para-real-todos-v1",
          },
        },
      });
    } catch {
      /* */
    }
    ok += 1;
    console.log("  OK", String(p.id).slice(0, 8), money(re), "→ real", money(nextBal));
  }

  console.log("\n==> Migrados:", ok, "· total", money(total));
  console.log("OK");
}

main().catch((e) => {
  console.error("FALHA:", e.message || e);
  process.exit(1);
});
