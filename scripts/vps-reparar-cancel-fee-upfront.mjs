#!/usr/bin/env node
/**
 * Repara cancelamentos fee_upfront que devolveram stake (ou nada)
 * e NÃO devolveram a dedução ArbiShield.
 *
 * FIX=1 node scripts/vps-reparar-cancel-fee-upfront.mjs
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

function n(v) {
  return Number(v || 0);
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 300)}`);
  return data;
}

function isFeeUpfront(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  );
}

function feeOf(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  let fee = n(
    row.platform_deduction_cents ??
      row.platform_profit_cents ??
      meta.fee_charged_cents ??
      0
  );
  if (fee > 0) return fee;
  const stake = n(row.responsibility_cents || row.amount_cents || meta.stake_cents);
  let odd = Number(row.odd || meta.market_odd || 0);
  const mt = String(meta.market_type || "").toUpperCase();
  if (mt === "LAY" && odd > 1.01) odd = odd / (odd - 1);
  if (stake > 0 && odd > 1.01) {
    const profit = Math.max(0, Math.round(stake * odd) - stake);
    const user = Math.round(stake * 0.015);
    fee = Math.max(0, profit - user);
  }
  return fee;
}

async function main() {
  console.log("==> Reparar cancel fee_upfront", FIX ? "(FIX=1)" : "(dry-run)");
  const tables = ["protections", "back_protections"];
  let fixed = 0;

  for (const table of tables) {
    const rows = await sb(
      `/rest/v1/${table}?status=eq.cancelled&select=*&order=settled_at.desc&limit=80`
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isFeeUpfront(row)) continue;
      const fee = feeOf(row);
      if (!(fee > 0)) continue;

      const txs = await sb(
        `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(row.id)}&type=in.(protection_refund,protection_fee)&select=id,type,amount_cents,metadata&order=created_at.desc&limit=20`
      );
      const list = Array.isArray(txs) ? txs : [];
      const feeRefunded = list.some((t) => {
        const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
        return (
          t.type === "protection_refund" &&
          (meta.refund_kind === "fee" ||
            n(t.amount_cents) === fee ||
            meta.billing_model === "fee_upfront_v1")
        );
      });
      // Já tem refund da taxa?
      if (feeRefunded && list.some((t) => t.type === "protection_refund" && n(t.amount_cents) === fee)) {
        continue;
      }
      // Tem refund do stake (errado) ou nenhum refund da taxa
      const stake = n(row.responsibility_cents || row.amount_cents);
      const wrongStakeRefund = list.some(
        (t) =>
          t.type === "protection_refund" &&
          n(t.amount_cents) === stake &&
          stake !== fee
      );
      const missingFeeRefund = !list.some(
        (t) => t.type === "protection_refund" && n(t.amount_cents) === fee
      );

      if (!missingFeeRefund && !wrongStakeRefund) continue;

      const balType = String(
        (row.metadata && row.metadata.balance_type) || "REAL"
      ).toUpperCase();

      console.log(
        " ",
        table,
        String(row.id).slice(0, 8),
        "fee",
        money(fee),
        wrongStakeRefund ? "(teve estorno de stake)" : "(sem estorno de taxa)"
      );

      if (!FIX) continue;

      const prof = await sb(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}&select=balance_cents,demo_balance_cents,investor_balance_cents&limit=1`
      );
      const p = Array.isArray(prof) ? prof[0] : null;
      if (!p) continue;

      const patch = { updated_at: new Date().toISOString() };
      if (balType === "DEMO") {
        patch.demo_balance_cents = n(p.demo_balance_cents) + fee;
      } else if (balType === "INVESTOR") {
        patch.investor_balance_cents = n(p.investor_balance_cents) + fee;
      } else {
        patch.balance_cents = n(p.balance_cents) + fee;
      }

      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        body: patch,
      });

      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        body: {
          user_id: row.user_id,
          type: "protection_refund",
          amount_cents: fee,
          ref: row.id,
          metadata: {
            protection_id: row.id,
            billing_model: "fee_upfront_v1",
            refund_kind: "fee",
            repair: true,
            note: "reparo: estorno da dedução no cancelamento",
          },
        },
      }).catch((e) => console.warn("tx:", e.message || e));

      fixed += 1;
      console.log("    → creditado", money(fee), balType);
    }
  }

  console.log(FIX ? `\nOK — reparados: ${fixed}` : "\nDry-run. Rode com FIX=1 para aplicar.");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
