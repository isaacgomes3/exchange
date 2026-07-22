#!/usr/bin/env node
/**
 * Corrige overcredit do Pedro Iuri após FIX que creditou settlements a mais.
 *
 * Antes do bug: real R$ 6.245,71 + reusable R$ 250,00
 * Correto após mover: real R$ 6.495,71 · reusable R$ 0,00
 * Ficou: real R$ 13.643,02
 *
 * Relatório:
 *   node scripts/vps-fix-pedro-overcredit.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-fix-pedro-overcredit.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf").trim().toLowerCase();
const NAME = String(
  process.env.NAME || "PEDRO IURI TEIXEIRA DOS SANTOS"
).trim();
/** real correto = 624571 + 25000 */
const TARGET_REAL_CENTS = Math.round(
  Number(process.env.TARGET_REAL_CENTS || 649571)
);
const TARGET_REUSABLE_CENTS = Math.round(
  Number(process.env.TARGET_REUSABLE_CENTS || 0)
);

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
  console.log("==> Corrigir overcredit Pedro Iuri");
  console.log("    alvo real:", money(TARGET_REAL_CENTS));
  console.log("    alvo reutil:", money(TARGET_REUSABLE_CENTS));
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");

  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents&order=created_at.desc&limit=5000`
  );
  const list = (Array.isArray(rows) ? rows : []).filter((r) =>
    String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
  );
  let user = list[0];
  if (!user) {
    const q = encodeURIComponent("%" + NAME + "%");
    const byName = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents&full_name=ilike.${q}&limit=5`
    );
    user = Array.isArray(byName) ? byName[0] : null;
  }
  if (!user) throw new Error("Pedro não encontrado");

  const bal = n(user.balance_cents);
  const reusable = n(user.reusable_balance_cents);
  const delta = bal - TARGET_REAL_CENTS;

  console.log("\n  user:", user.id);
  console.log("  nome:", user.full_name);
  console.log("  real agora:", money(bal));
  console.log("  reutil agora:", money(reusable));
  console.log("  diferença vs alvo:", money(delta), delta > 0 ? "(a debitar)" : delta < 0 ? "(a creditar)" : "(ok)");

  // Mostra txs recentes do fix
  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=40`
  );
  console.log("\n==> Últimas wallet_tx:");
  for (const t of Array.isArray(txs) ? txs : []) {
    const fix = t.metadata?.fix || t.metadata?.reason || "";
    console.log(
      `  ${t.created_at}  ${t.type}  ${money(t.amount_cents)}  ${String(fix).slice(0, 60)}`
    );
  }

  if (delta === 0 && reusable === TARGET_REUSABLE_CENTS) {
    console.log("\n  Já está no alvo. OK");
    return;
  }

  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-fix-pedro-overcredit.mjs");
    console.log("OK");
    return;
  }

  if (delta < 0) {
    throw new Error(
      `Saldo real (${money(bal)}) já está ABAIXO do alvo (${money(TARGET_REAL_CENTS)}) — não auto-credita. Ajuste TARGET_REAL_CENTS.`
    );
  }

  console.log("\n==> Debitando overcredit", money(delta));
  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: TARGET_REAL_CENTS,
        reusable_balance_cents: TARGET_REUSABLE_CENTS,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: TARGET_REAL_CENTS,
        reusable_balance_cents: TARGET_REUSABLE_CENTS,
      },
    });
  }

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: user.id,
      type: "admin_adjustment",
      amount_cents: -delta,
      metadata: {
        reason: "clawback overcredit audit Pedro (só deveria mover R$ 250 reusable→real)",
        before_real_cents: bal,
        after_real_cents: TARGET_REAL_CENTS,
        target_real_cents: TARGET_REAL_CENTS,
        fix: "vps-fix-pedro-overcredit-v1",
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
