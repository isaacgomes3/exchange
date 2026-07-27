#!/usr/bin/env node
/**
 * Correção em lote — suspeitos da auditoria global (excesso Reembolso → Real)
 *
 * Casos (audit 2026-07-27):
 *   LEANDRO GUSTAVO…  8604b7c2  excesso R$ 154,83
 *   CARLOS ROBERTO    cbd542d3  excesso R$  80,00
 *   JOÃO PAULO LEITE… aba4de06  excesso R$  20,00  (keep Arbi R$ 450)
 *
 * Relatório: node scripts/vps-correcao-reembolso-suspeitos-lote.mjs
 * Aplicar:   FIX=1 node scripts/vps-correcao-reembolso-suspeitos-lote.mjs
 *
 * Marker: vps-correcao-reembolso-suspeitos-lote-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";

const TARGETS = [
  {
    name: "LEANDRO GUSTAVO DA SILVEIRA LOPES",
    idPrefix: "8604b7c2",
  },
  {
    name: "CARLOS ROBERTO",
    idPrefix: "cbd542d3",
  },
  {
    name: "JOÃO PAULO LEITE DE SOUZA RODRIGUES",
    idPrefix: "aba4de06",
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

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  return Number(v || 0);
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  return data;
}

async function resolveByPrefix(prefix) {
  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents&id=gte.${prefix}-0000-0000-0000-000000000000&id=lte.${prefix}-ffff-ffff-ffff-ffffffffffff`
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function computePlan(p) {
  const reembolso = n(p.deduction_balance_cents);
  const real = n(p.balance_cents) + n(p.reusable_balance_cents);

  const settles = await sb(
    `/rest/v1/wallet_transactions?select=amount_cents,metadata&user_id=eq.${encodeURIComponent(p.id)}&type=eq.protection_settlement&limit=500`
  );
  let sumArbi = 0;
  let sumEx = 0;
  for (const t of Array.isArray(settles) ? settles : []) {
    if (n(t.amount_cents) <= 0) continue;
    const o = String(metaOf(t).outcome || "").toLowerCase();
    if (o === "arbishield" || o === "lost_exchange") sumArbi += n(t.amount_cents);
    else if (o === "exchange" || o === "won_exchange") sumEx += n(t.amount_cents);
  }

  const wds = await sb(
    `/rest/v1/withdrawals?select=amount_cents,status,metadata&user_id=eq.${encodeURIComponent(p.id)}&limit=100`
  );
  let wdReemb = 0;
  for (const w of Array.isArray(wds) ? wds : []) {
    const st = String(w.status || "").toLowerCase();
    if (["rejected", "cancelled", "canceled"].includes(st)) continue;
    const origin = String(metaOf(w).origin || metaOf(w).label || "").toUpperCase();
    if (
      origin.includes("REEMBOLSO") ||
      origin.includes("DEDUCTION") ||
      origin.includes("DEDUCAO")
    ) {
      wdReemb += n(w.amount_cents);
    }
  }

  const keepArbi = Math.max(0, sumArbi - wdReemb);
  const move = Math.max(0, reembolso - keepArbi);

  return {
    reembolso,
    real,
    apostador: real + reembolso + n(p.demo_balance_cents),
    sumArbi,
    sumEx,
    wdReemb,
    keepArbi,
    move,
  };
}

async function alreadyFixed(uid) {
  const rows = await sb(
    `/rest/v1/wallet_transactions?select=metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&type=eq.admin_adjustment&order=created_at.desc&limit=30`
  );
  return (Array.isArray(rows) ? rows : []).some((t) => {
    const k = String(metaOf(t).kind || "");
    return (
      k === "correcao_reembolso_suspeitos_lote_v1" ||
      k === "correcao_reembolso_cliente_v1" ||
      k.startsWith("correcao_reembolso_")
    );
  });
}

async function main() {
  console.log("==> Correção lote suspeitos Reembolso");
  console.log("    marker: vps-correcao-reembolso-suspeitos-lote-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    alvos:", TARGETS.length);

  let totalMove = 0;
  const plans = [];

  for (const t of TARGETS) {
    console.log("\n----------------------------------------------------------------");
    console.log(" ", t.name, `(${t.idPrefix}…)`);
    const p = await resolveByPrefix(t.idPrefix);
    if (!p) {
      console.log("  !! perfil não encontrado");
      continue;
    }
    console.log("  id:", p.id, "|", p.full_name);

    if (await alreadyFixed(p.id)) {
      console.log("  ✓ já tem correção recente — pulando");
      continue;
    }

    const plan = await computePlan(p);
    console.log("  Real     :", money(plan.real));
    console.log("  Reembolso:", money(plan.reembolso));
    console.log("  Apostador:", money(plan.apostador));
    console.log("  Arbi hist:", money(plan.sumArbi), "| Exch:", money(plan.sumEx), "| saqueR:", money(plan.wdReemb));
    console.log("  keep Arbi:", money(plan.keepArbi));
    console.log("  MOVER → Real:", money(plan.move));
    console.log(
      "  Depois → Real",
      money(plan.real + plan.move),
      "| Reembolso",
      money(plan.keepArbi),
      "| Apostador",
      money(plan.apostador),
      "(igual)"
    );

    if (plan.move <= 0) {
      console.log("  (nada a mover)");
      continue;
    }

    totalMove += plan.move;
    plans.push({ p, plan, label: t.name });
  }

  console.log("\n================================================================");
  console.log(" TOTAL a mover:", money(totalMove), `| ${plans.length} cliente(s)`);
  console.log("================================================================");

  if (!plans.length) {
    console.log("Nada a aplicar.");
    return;
  }

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para aplicar o lote.");
    return;
  }

  for (const { p, plan, label } of plans) {
    const newBal = n(p.balance_cents) + plan.move;
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: newBal,
        deduction_balance_cents: plan.keepArbi,
        updated_at: new Date().toISOString(),
      },
    });
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: p.id,
        type: "admin_adjustment",
        amount_cents: 0,
        ref: p.id,
        metadata: {
          kind: "correcao_reembolso_suspeitos_lote_v1",
          from_bucket: "deduction_balance_cents",
          to_bucket: "balance_cents",
          amount_cents: plan.move,
          keep_arbi_cents: plan.keepArbi,
          name: label,
          reason:
            "lote global: excesso Reembolso (settle Exchange/legado) → Real; preserva Arbi",
          settle_arbi_cents: plan.sumArbi,
          settle_exchange_cents: plan.sumEx,
        },
      },
    });
    console.log("  ✓", label, "moveu", money(plan.move));
  }

  console.log("\n==> LOTE APLICADO");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
