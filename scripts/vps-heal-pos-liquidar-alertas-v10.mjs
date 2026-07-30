#!/usr/bin/env node
/**
 * Heal dos alertas pós-liquidar A LIQUIDAR v10:
 *  1) Kauno Carlos 7200f01a — cobra dedução faltante (R$ 1,92)
 *  2) Kauno Luiz/Carlos — reconcilia metadata de stake duplicado (sem mexer saldo se só ledger)
 *  3) Barracas Carlos 4ef625d3 — estorna dedução acima do esperado (R$ 6,05 → R$ 5,16)
 *
 * Dry-run:
 *   node scripts/vps-heal-pos-liquidar-alertas-v10.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-heal-pos-liquidar-alertas-v10.mjs
 *
 * Marker: vps-heal-pos-liquidar-alertas-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const TAG = "heal-pos-liquidar-alertas-v10";

const TARGETS = [
  {
    key: "kauno-carlos-fee",
    prefix: "7200f01a",
    action: "charge_fee_shortfall",
  },
  {
    key: "kauno-luiz-stake-meta",
    prefix: "d072c5a8",
    action: "reconcile_stake_meta",
  },
  {
    key: "kauno-carlos-stake-meta",
    prefix: "7200f01a",
    action: "reconcile_stake_meta",
  },
  {
    key: "kauno-carlos-fee-over",
    prefix: "7200f01a",
    action: "refund_fee_over",
  },
  {
    key: "kauno-senilvo-fee-over",
    prefix: "003d5bc9",
    action: "refund_fee_over",
  },
  {
    key: "barracas-carlos-fee-over",
    prefix: "4ef625d3",
    action: "refund_fee_over",
  },
  {
    key: "barracas-luiz-fee-over",
    prefix: "c13d3a7d",
    action: "refund_fee_over",
  },
];

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

const contract = await import(
  pathToFileURL(path.resolve(__dirname, "lib/protection-flow-contract.mjs")).href
);
const {
  computeArbiShieldDeductionCents,
  settlementDeductionCents,
  PROTECTION_FLOW_CONTRACT_VERSION,
} = contract;

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
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 600)}`);
  return data;
}

async function findProtection(prefix) {
  const pfx = String(prefix).toLowerCase();
  for (const table of ["protections", "back_protections"]) {
    const rows = await sb(
      `/rest/v1/${table}?id=like.${pfx}*&select=*&limit=5`
    ).catch(() => []);
    if (Array.isArray(rows) && rows[0]) return { ...rows[0], _table: table };
  }
  // fallback: scan recent
  for (const table of ["protections", "back_protections"]) {
    const rows = await sb(
      `/rest/v1/${table}?select=*&order=created_at.desc&limit=500`
    ).catch(() => []);
    const hit = (Array.isArray(rows) ? rows : []).find((r) =>
      String(r.id).toLowerCase().startsWith(pfx)
    );
    if (hit) return { ...hit, _table: table };
  }
  return null;
}

function analyzeLedger(txs, amount) {
  let feeCharged = 0;
  let stakeReturned = 0;
  let reembolsoCredited = 0;
  let negSettlements = 0;
  const feeDebits = [];
  for (const t of txs) {
    const m = metaOf(t);
    const amt = n(t.amount_cents);
    if (m.clawback_reembolso_cents != null) {
      reembolsoCredited -= Math.abs(n(m.clawback_reembolso_cents) || Math.abs(amt));
      continue;
    }
    if (m.clawback_stake_cents != null) {
      stakeReturned -= Math.abs(n(m.clawback_stake_cents));
      if (m.fee_refunded_cents != null) feeCharged -= Math.abs(n(m.fee_refunded_cents));
      continue;
    }
    const exchangeFee =
      t.type === "protection_fee" && amt < 0
        ? Math.abs(amt)
        : t.type === "protection_settlement" &&
            amt < 0 &&
            (m.outcome === "exchange" ||
              m.exchange_no_credit === true ||
              /settle exchange|cobra dedu|heal-pos-liquidar/i.test(
                String(m.note || "")
              ))
          ? Math.abs(amt)
          : t.type === "protection_settlement" &&
              amt >= 0 &&
              n(m.fee_charged_now_cents) > 0 &&
              (m.outcome === "exchange" || m.exchange_no_credit === true)
            ? n(m.fee_charged_now_cents)
            : 0;
    if (exchangeFee > 0) {
      feeCharged += exchangeFee;
      feeDebits.push({
        id: String(t.id || "").slice(0, 8),
        type: t.type,
        amt,
        fee: exchangeFee,
        note: String(m.note || m.tag || "").slice(0, 60),
      });
    }
    if (t.type === "protection_settlement" && amt < 0) negSettlements += 1;
    if (
      t.type === "protection_refund" &&
      amt > 0 &&
      (m.fee_expected_cents != null ||
        m.fee_was_cents != null ||
        /dedu[cç][aã]o|estorna.*fee|fee_refund|fee excedente/i.test(
          String(m.note || "")
        ))
    ) {
      feeCharged -= amt;
    }
    if (
      t.type === "protection_settlement" &&
      amt > 0 &&
      (m.outcome === "arbishield" ||
        (m.bucket === "deduction_balance_cents" && m.outcome !== "exchange"))
    ) {
      reembolsoCredited += amt;
    }
    if (t.type === "protection_settlement" && m.stake_returned === true) {
      if (m.returned_stake_cents != null) {
        stakeReturned += Math.abs(n(m.returned_stake_cents));
      } else if (amt > 0 && m.outcome !== "arbishield") {
        stakeReturned += amt;
      }
    }
  }
  return {
    feeCharged: Math.max(0, feeCharged),
    stakeReturned: Math.max(0, stakeReturned),
    stakeEffective: Math.min(amount, Math.max(0, stakeReturned)),
    reembolsoCredited: Math.max(0, reembolsoCredited),
    negSettlements,
    feeDebits,
  };
}

async function insertTx(row) {
  return sb(`/rest/v1/wallet_transactions`, { method: "POST", body: row });
}

async function main() {
  console.log("==> Heal alertas pós-liquidar A LIQUIDAR");
  console.log("    contrato:", PROTECTION_FLOW_CONTRACT_VERSION);
  console.log("    FIX:", FIX ? "SIM" : "não (dry-run)");

  let did = 0;

  for (const t of TARGETS) {
    console.log(`\n---- ${t.key} (${t.prefix}) ----`);
    const row = await findProtection(t.prefix);
    if (!row) {
      console.log("  XX proteção não encontrada");
      continue;
    }
    const amount = n(row.responsibility_cents || row.amount_cents);
    const fee =
      computeArbiShieldDeductionCents(row) || settlementDeductionCents(row);
    const txs = await sb(
      `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
        row.id
      )}&select=id,type,amount_cents,metadata,created_at&order=created_at.desc&limit=40`
    );
    const list = Array.isArray(txs) ? txs : [];
    const prior = analyzeLedger(list, amount);
    const p = (
      await sb(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(
          row.user_id
        )}&select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents&limit=1`
      )
    )?.[0];
    console.log(
      `  ${String(row.id).slice(0, 8)} ${p?.full_name || "?"} stake=${money(
        amount
      )} fee_esp=${money(fee)}`
    );
    console.log(
      `  ledger: fee=${money(prior.feeCharged)} stake=${money(
        prior.stakeReturned
      )} (efetivo ${money(prior.stakeEffective)}) reemb=${money(
        prior.reembolsoCredited
      )} neg_tx=${prior.negSettlements}`
    );
    if (prior.feeDebits?.length) {
      console.log("  fee débitos:");
      for (const d of prior.feeDebits) {
        console.log(
          `    - ${d.id} ${d.type} amt=${d.amt} fee=+${d.fee} ${d.note}`
        );
      }
    }
    console.log(
      `  txs (${list.length}):`,
      list
        .slice(0, 6)
        .map((x) => {
          const m = metaOf(x);
          return `${x.type}:${n(x.amount_cents)}:${m.outcome || "-"}:rs=${
            m.returned_stake_cents ?? "-"
          }:fc=${m.fee_charged_now_cents ?? "-"}`;
        })
        .join(" | ")
    );

    if (t.action === "charge_fee_shortfall") {
      const due = Math.max(0, fee - prior.feeCharged);
      if (due <= 0) {
        console.log("  OK fee já completa");
        continue;
      }
      console.log(`  → cobrar fee faltante ${money(due)}`);
      if (!FIX) continue;
      const bal = n(p.balance_cents) + n(p.reusable_balance_cents);
      const take = Math.min(bal, due);
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        body: {
          updated_at: new Date().toISOString(),
          balance_cents: bal - take,
          reusable_balance_cents: 0,
        },
      });
      await insertTx({
        user_id: row.user_id,
        type: "protection_settlement",
        amount_cents: -take,
        ref: row.id,
        metadata: {
          tag: TAG,
          outcome: "exchange",
          exchange_no_credit: true,
          fee_charged_now_cents: take,
          fee_expected_cents: fee,
          note: `${TAG}: cobra dedução faltante Kauno Carlos`,
          protection_id: row.id,
        },
      });
      console.log(`  OK cobrado ${money(take)}`);
      did += 1;
    }

    if (t.action === "reconcile_stake_meta") {
      const excess = Math.max(0, prior.stakeReturned - amount);
      if (excess <= 0) {
        console.log("  OK stake metadata sem excesso");
        continue;
      }
      console.log(
        `  → reconciliar metadata stake −${money(excess)} (sem débito de carteira)`
      );
      if (!FIX) continue;
      await insertTx({
        user_id: row.user_id,
        type: "protection_settlement",
        amount_cents: 0,
        ref: row.id,
        metadata: {
          tag: TAG,
          outcome: "exchange",
          clawback_stake_cents: excess,
          ledger_only: true,
          note: `${TAG}: reconcilia metadata stake duplicado (re-run)`,
          protection_id: row.id,
        },
      });
      console.log("  OK metadata reconciliada");
      did += 1;
    }

    if (t.action === "refund_fee_over") {
      const over = Math.max(0, prior.feeCharged - fee);
      if (over <= 0) {
        console.log("  OK fee sem excesso");
        continue;
      }
      // estorna qualquer excesso > R$ 0,01 (antes ignorava ≤0,50 e deixava alerta)
      console.log(`  → estornar fee excedente ${money(over)}`);
      if (!FIX) continue;
      const bal = n(p.balance_cents) + n(p.reusable_balance_cents);
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        body: {
          updated_at: new Date().toISOString(),
          balance_cents: bal + over,
          reusable_balance_cents: 0,
        },
      });
      await insertTx({
        user_id: row.user_id,
        type: "protection_refund",
        amount_cents: over,
        ref: row.id,
        metadata: {
          tag: TAG,
          outcome: "exchange",
          note: `${TAG}: estorna fee excedente (dedução acima do esperado)`,
          fee_expected_cents: fee,
          fee_was_cents: prior.feeCharged,
          protection_id: row.id,
        },
      });
      console.log(`  OK estornado ${money(over)}`);
      did += 1;
    }
  }

  console.log(`\nConcluído. Ações aplicadas: ${did}. FIX=${FIX ? "sim" : "não"}`);
  if (!FIX) console.log("(dry-run) Exporte FIX=1 para aplicar.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
