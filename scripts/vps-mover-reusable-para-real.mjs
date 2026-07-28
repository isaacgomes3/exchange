#!/usr/bin/env node
/**
 * Move crédito de reusable → balance (caso João Paulo / Klubi×Haka R$ 200).
 *
 *   node scripts/vps-mover-reusable-para-real.mjs
 *   FIX=1 node scripts/vps-mover-reusable-para-real.mjs
 *
 * Defaults: NAME=JOÃO PAULO LEITE, AMOUNT=20000 (R$ 200)
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(process.env.NAME || "JOÃO PAULO LEITE").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "").trim().toLowerCase();
const AMOUNT_CENTS = Math.round(Number(process.env.AMOUNT_CENTS || 20000));
const REASON = String(
  process.env.REASON || "mover reusable→real (settlement arbishield Klubi×Haka)"
).trim();
const PROTECTION_ID = String(
  process.env.PROTECTION_ID || "8146fd5c-142d-40a1-96e1-0831ff071fc3"
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
  console.log("==> Mover reusable → saldo real");
  console.log("    valor:", money(AMOUNT_CENTS));
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    proteção:", PROTECTION_ID || "—");

  let p = null;
  if (ID_PREFIX) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,account_status&order=created_at.desc&limit=5000`
    );
    const list = (Array.isArray(rows) ? rows : []).filter((r) =>
      String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
    );
    if (!list.length) throw new Error(`sem profile id~${ID_PREFIX}`);
    p = list[0];
  } else {
    const q = encodeURIComponent("%" + NAME + "%");
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,account_status&full_name=ilike.${q}&order=created_at.desc&limit=20`
    );
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) throw new Error(`sem profile nome~${NAME}`);
    if (list.length > 1) {
      console.log("Matches:");
      list.forEach((r) =>
        console.log(
          `  ${r.id}  ${r.full_name}  real=${money(r.balance_cents)}  reutil=${money(r.reusable_balance_cents)}`
        )
      );
    }
    p = list[0];
  }

  const bal = n(p.balance_cents);
  const reusable = n(p.reusable_balance_cents);
  const move = Math.min(AMOUNT_CENTS, reusable);

  console.log("\n  user:", p.id);
  console.log("  nome:", p.full_name || "—");
  console.log("  real:", money(bal));
  console.log("  reutilizável:", money(reusable));
  console.log("  a mover:", money(move));

  if (move <= 0) {
    console.log("\n  Nada a mover (reusable insuficiente ou zero).");
    console.log("OK");
    return;
  }
  if (move < AMOUNT_CENTS) {
    console.log(
      `  ⚠ reusable (${money(reusable)}) < pedido (${money(AMOUNT_CENTS)}) — move só o disponível`
    );
  }

  const nextBal = bal + move;
  const nextReusable = reusable - move;
  console.log("  depois → real", money(nextBal), "| reutil", money(nextReusable));

  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-mover-reusable-para-real.mjs");
    console.log("OK");
    return;
  }

  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        reusable_balance_cents: nextReusable,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        reusable_balance_cents: nextReusable,
      },
    });
  }

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: move,
      balance_before_cents: bal,
      balance_after_cents: nextBal,
      ref: PROTECTION_ID || null,
      metadata: {
        reason: REASON,
        source: "admin_manual_vps",
        from_bucket: "reusable_balance_cents",
        to_bucket: "balance_cents",
        amount_cents: move,
        protection_id: PROTECTION_ID || null,
        note: "reclassificação — settlement já creditado em reusable",
        fix: "vps-mover-reusable-para-real-v1",
      },
    },
  });

  console.log("\n  OK movido", money(move), "reusable → real");
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
