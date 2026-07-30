#!/usr/bin/env node
/**
 * Clawback Senilvo — proteção 003d5bc9 foi CANCELADA (não Empate Anula).
 * O reparo dia-v10 mapeou cancelled→void e creditou R$200 indevidos.
 *
 * Correto fee_upfront cancel: só estorna a taxa (já feito: +R$4,96).
 * Stake NUNCA volta (não foi travado).
 *
 * Dry-run:
 *   node scripts/vps-clawback-senilvo-cancel-003d5bc9.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-clawback-senilvo-cancel-003d5bc9.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const PROT_PREFIX = String(process.env.PROT || "003d5bc9").trim().toLowerCase();
const AMOUNT = Math.round(Number(process.env.AMOUNT_CENTS || 20000));
const TAG = "clawback-senilvo-cancel-003d5bc9-v1";

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

function money(c) {
  return (Number(c || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
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
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 500)}`);
  return data;
}

async function main() {
  console.log("==> Clawback Senilvo cancel≠void");
  console.log("    PROT~", PROT_PREFIX);
  console.log("    AMOUNT", money(AMOUNT));
  console.log("    FIX:", FIX ? "SIM" : "não (dry-run)");

  // find protection
  let row = null;
  let table = "protections";
  for (const t of ["protections", "back_protections"]) {
    const rows = await sb(
      `/rest/v1/${t}?select=id,user_id,status,settled_outcome,amount_cents,responsibility_cents,metadata&order=created_at.desc&limit=800`
    );
    const hit = (Array.isArray(rows) ? rows : []).find((r) =>
      String(r.id || "").toLowerCase().startsWith(PROT_PREFIX)
    );
    if (hit) {
      row = hit;
      table = t;
      break;
    }
  }
  if (!row) throw new Error("proteção não encontrada");

  const st = String(row.status || "").toLowerCase();
  console.log("\n  proteção:", row.id);
  console.log("  table:   ", table);
  console.log("  status:  ", row.status);
  console.log("  outcome: ", row.settled_outcome || "(null)");

  if (st !== "cancelled" && st !== "canceled") {
    console.log("\n⚠ status não é cancelled — abortando por segurança.");
    process.exit(2);
  }

  // already clawed?
  const txs = await sb(
    `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
      row.id
    )}&select=id,type,amount_cents,created_at,metadata&order=created_at.desc&limit=40`
  );
  const tlist = Array.isArray(txs) ? txs : [];
  const already = tlist.some((t) => {
    const m = metaOf(t);
    return m.tag === TAG || String(m.note || "").includes(TAG);
  });
  const badCredit = tlist.filter((t) => {
    const m = metaOf(t);
    return (
      t.type === "protection_settlement" &&
      n(t.amount_cents) === AMOUNT &&
      m.tag === "repair-protecoes-dia-v10" &&
      m.stake_returned === true
    );
  });

  console.log("  créditos indevidos v10:", badCredit.length);
  console.log("  clawback já feito:    ", already ? "SIM" : "não");

  const prof = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      row.user_id
    )}&select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,deduction_balance_cents&limit=1`
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) throw new Error("perfil não encontrado");

  const bal = n(p.balance_cents) + n(p.reusable_balance_cents);
  console.log("\n  cliente: ", p.full_name);
  console.log("  Apostador:", money(bal));
  console.log("  locked:   ", money(p.locked_balance_cents));
  console.log("  Reembolso:", money(p.deduction_balance_cents));
  console.log("  após clawback Apostador seria:", money(bal - AMOUNT));

  if (already) {
    console.log("\nOK — clawback já aplicado. Nada a fazer.");
    return;
  }
  if (!badCredit.length) {
    console.log(
      "\n⚠ Não achei tx repair +R$200 stake_returned. Confira manualmente antes de FIX."
    );
  }
  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para debitar", money(AMOUNT));
    return;
  }
  if (bal < AMOUNT) {
    throw new Error(
      `Saldo insuficiente para clawback (${money(bal)} < ${money(AMOUNT)})`
    );
  }

  const now = new Date().toISOString();
  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
    method: "PATCH",
    body: {
      balance_cents: n(p.balance_cents) + n(p.reusable_balance_cents) - AMOUNT,
      reusable_balance_cents: 0,
      updated_at: now,
    },
  });

  // insert tx sem balance_type coluna
  const payload = {
    user_id: row.user_id,
    type: "protection_settlement",
    amount_cents: -AMOUNT,
    ref: row.id,
    metadata: {
      tag: TAG,
      note: `${TAG}: estorno crédito indevido — cancel≠void (fee_upfront só devolve taxa)`,
      outcome: "cancel",
      billing_model: "fee_upfront_v1",
      clawback_cents: AMOUNT,
      protection_id: row.id,
      reason: "repair-dia-v10 mapeou cancelled como void e devolveu stake",
    },
    created_at: now,
  };
  try {
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: { ...payload, note: payload.metadata.note },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/PGRST204|note/i.test(msg)) {
      await sb(`/rest/v1/wallet_transactions`, {
        method: "POST",
        body: payload,
      });
    } else {
      throw err;
    }
  }

  const after = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      row.user_id
    )}&select=balance_cents,reusable_balance_cents&limit=1`
  );
  const a = Array.isArray(after) ? after[0] : null;
  console.log("\nOK clawback aplicado.");
  console.log(
    "  Apostador agora:",
    money(n(a?.balance_cents) + n(a?.reusable_balance_cents))
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
