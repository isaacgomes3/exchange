#!/usr/bin/env node
/**
 * Clawback: cancel fee_upfront que devolveu STAKE em vez da dedução.
 *
 * Caso Carlos (vídeo 2026-07-27):
 *   create fee_upfront LAY R$1000 @10 → debitou só R$96,11
 *   cancel devolveu R$1.000 (errado)
 *   net windfall = R$903,89 → debitar do Saldo Real
 *
 * Na VPS:
 *   node scripts/vps-clawback-cancel-stake-fee-upfront.mjs
 *   FIX=1 node scripts/vps-clawback-cancel-stake-fee-upfront.mjs
 *
 * Opcional:
 *   EMAIL=carloskku4@gmail.com
 *   USER_ID=...
 *   PROTECTION_ID=...
 */
import fs from "node:fs";
import path from "node:path";
import { calcLay } from "./lib/protection-flow-contract.mjs";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com").trim().toLowerCase();
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const PROTECTION_ID_ENV = String(process.env.PROTECTION_ID || "").trim();
const REPAIR_TAG = "clawback-cancel-stake-fee-upfront-v1";

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

function n(v) {
  return Math.max(0, Math.trunc(Number(v) || 0));
}
function money(c) {
  return (n(c) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 400)}`);
  return data;
}

function metaOf(row) {
  return row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function isFeeUpfrontish(row, txs) {
  const meta = metaOf(row);
  if (meta.billing_model === "stake_lock_v1" || meta.stake_lock === true) return false;
  if (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront") ||
    n(meta.fee_charged_cents) > 0
  ) {
    return true;
  }
  // wallet: teve protection_fee e NÃO teve protection_lock do stake
  const list = Array.isArray(txs) ? txs : [];
  const feeTx = list.some(
    (t) => t.type === "protection_fee" || (t.type === "protection_lock" && Math.abs(n(t.amount_cents)) < n(row.amount_cents) * 0.5)
  );
  const lockStake = list.some(
    (t) =>
      t.type === "protection_lock" &&
      Math.abs(n(t.amount_cents)) === n(row.responsibility_cents || row.amount_cents)
  );
  return feeTx && !lockStake;
}

function feeExpected(row, txs) {
  const meta = metaOf(row);
  let fee = n(
    row.platform_deduction_cents ??
      row.platform_profit_cents ??
      meta.fee_charged_cents ??
      0
  );
  if (fee > 0) return fee;
  const list = Array.isArray(txs) ? txs : [];
  const feeTx = list.find((t) => t.type === "protection_fee");
  if (feeTx) return Math.abs(n(feeTx.amount_cents));
  const stake = n(row.responsibility_cents || row.amount_cents);
  const odd = Number(row.odd || meta.market_odd || 0);
  const mt = String(meta.market_type || "LAY").toUpperCase();
  if (mt === "LAY" && stake > 0 && odd > 1.01) {
    return n(calcLay(stake, odd).arbiShieldDeductionCents);
  }
  return 0;
}

async function resolveUserId() {
  if (USER_ID_ENV) return USER_ID_ENV;
  // auth.users via profiles email se existir
  const byEmail = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents&email=eq.${encodeURIComponent(EMAIL)}&limit=3`
  ).catch(() => null);
  if (Array.isArray(byEmail) && byEmail[0]) return String(byEmail[0].id);

  // fallback: ilike no nome Carlos Roberto
  const byName = await sb(
    `/rest/v1/profiles?select=id,full_name,email,balance_cents,locked_balance_cents&full_name=ilike.*Carlos%20Roberto*&limit=5`
  ).catch(() => []);
  if (Array.isArray(byName) && byName.length === 1) return String(byName[0].id);
  if (Array.isArray(byName) && byName.length > 1) {
    console.log("Vários Carlos Roberto — use USER_ID=");
    for (const p of byName) {
      console.log(" ", p.id, p.full_name, p.email || "-", money(p.balance_cents));
    }
    process.exit(2);
  }
  throw new Error(`Usuário não encontrado (EMAIL=${EMAIL})`);
}

async function main() {
  console.log("==> Clawback cancel stake→fee_upfront", FIX ? "(FIX=1)" : "(dry-run)");
  console.log("    tag:", REPAIR_TAG);

  const userId = await resolveUserId();
  const profRows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,email,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents&limit=1`
  );
  const prof = Array.isArray(profRows) ? profRows[0] : null;
  if (!prof) throw new Error("perfil ausente");
  console.log(
    "    user:",
    prof.full_name || "-",
    prof.email || EMAIL,
    "Real",
    money(prof.balance_cents),
    "Congelado",
    money(prof.locked_balance_cents)
  );

  const candidates = [];
  for (const table of ["protections", "back_protections"]) {
    const q = PROTECTION_ID_ENV
      ? `/rest/v1/${table}?id=eq.${encodeURIComponent(PROTECTION_ID_ENV)}&select=*`
      : `/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}&status=eq.cancelled&select=*&order=settled_at.desc.nullslast&limit=30`;
    const rows = await sb(q);
    for (const row of Array.isArray(rows) ? rows : []) {
      const txs = await sb(
        `/rest/v1/wallet_transactions?or=(ref.eq.${encodeURIComponent(row.id)},metadata->>protection_id.eq.${encodeURIComponent(row.id)})&select=id,type,amount_cents,metadata,created_at&order=created_at.desc&limit=40`
      );
      const list = Array.isArray(txs) ? txs : [];
      if (!isFeeUpfrontish(row, list)) continue;

      const stake = n(row.responsibility_cents || row.amount_cents);
      const fee = feeExpected(row, list);
      if (!(stake > 0) || !(fee > 0) || stake === fee) continue;

      const stakeRefunds = list.filter(
        (t) =>
          t.type === "protection_refund" &&
          n(t.amount_cents) === stake &&
          metaOf(t).refund_kind !== "fee"
      );
      if (!stakeRefunds.length) continue;

      const alreadyClawed = list.some(
        (t) =>
          metaOf(t).repair_tag === REPAIR_TAG ||
          (metaOf(t).clawback === true &&
            Math.abs(n(t.amount_cents)) === stake - fee)
      );
      if (alreadyClawed) {
        console.log("  skip (já clawback)", table, String(row.id).slice(0, 8));
        continue;
      }

      const clawback = stake - fee;
      candidates.push({ table, row, stake, fee, clawback, stakeRefunds });
    }
  }

  if (!candidates.length) {
    console.log("\nNenhum cancel com estorno de stake indevido encontrado.");
    console.log("Se souber o id: PROTECTION_ID=... node ...");
    return;
  }

  let fixed = 0;
  for (const c of candidates) {
    console.log(
      "\n ",
      c.table,
      String(c.row.id).slice(0, 8),
      "stake",
      money(c.stake),
      "fee",
      money(c.fee),
      "→ clawback",
      money(c.clawback)
    );
    console.log(
      "    refunds stake:",
      c.stakeRefunds.map((t) => t.created_at).join(", ")
    );

    if (!FIX) continue;

    const fresh = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=balance_cents&limit=1`
    );
    const bal = n(Array.isArray(fresh) ? fresh[0]?.balance_cents : 0);
    if (bal < c.clawback) {
      console.warn(
        "    AVISO: saldo Real",
        money(bal),
        "< clawback",
        money(c.clawback),
        "— debitando o disponível"
      );
    }
    const next = Math.max(0, bal - c.clawback);
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: {
        balance_cents: next,
        updated_at: new Date().toISOString(),
      },
    });
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: userId,
        type: "admin_adjustment",
        amount_cents: -c.clawback,
        ref: c.row.id,
        metadata: {
          protection_id: c.row.id,
          repair: true,
          clawback: true,
          repair_tag: REPAIR_TAG,
          note:
            "Clawback: cancel fee_upfront creditou stake; cliente só tinha pago a dedução",
          stake_refunded_cents: c.stake,
          fee_should_refund_cents: c.fee,
          clawback_cents: c.clawback,
          balance_before_cents: bal,
          balance_after_cents: next,
        },
      },
    }).catch((e) => console.warn("tx:", e.message || e));

    console.log("    → Real", money(bal), "→", money(next));
    fixed += 1;
  }

  console.log(
    FIX
      ? `\nOK — clawbacks aplicados: ${fixed}`
      : "\nDry-run. Rode com FIX=1 para debitar o windfall (stake − fee)."
  );
  console.log(
    "Alvo típico Carlos após fix: Real ≈ R$ 10.067,52 (antes da proteção do vídeo)."
  );
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
