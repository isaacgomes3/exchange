#!/usr/bin/env node
/**
 * Rastreia settles Exchange/Arbi — Pedro Iuri (id~24037bdf)
 * Reembolso atual no admin: R$ 750,00
 *
 * Marker: vps-rastreia-settle-exchange-pedro-v1
 */
import fs from "node:fs";
import path from "node:path";

const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf")
  .trim()
  .toLowerCase();
const USER_ID = String(process.env.USER_ID || "").trim();
const NAME = String(
  process.env.NAME || "Pedro Iuri Teixeira dos Santos"
).trim();
const EXPECTED_REEMBOLSO = Math.round(
  Number(process.env.EXPECTED_REEMBOLSO_CENTS || 75000)
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
function outcomeOf(row) {
  const o = String(row.settled_outcome || "").toLowerCase();
  if (["arbishield", "won", "win", "user_won"].includes(o)) return "arbishield";
  if (["exchange", "lost", "loss"].includes(o)) return "exchange";
  const st = String(row.status || "").toLowerCase();
  if (st === "lost_exchange") return "arbishield";
  if (st === "won_exchange") return "exchange";
  return o || st || "";
}
function isFeeUpfront(row) {
  const meta = metaOf(row);
  return (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  );
}

async function sb(p) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
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

async function main() {
  console.log("\n==> Rastreia settles — Pedro Iuri");
  console.log("    marker: vps-rastreia-settle-exchange-pedro-v1");
  console.log("    Reembolso esperado (admin):", money(EXPECTED_REEMBOLSO));

  let uid = USER_ID;
  let p;
  if (!uid) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,investor_balance_cents,demo_balance_provider_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    p = Array.isArray(rows) && rows[0];
    if (!p) {
      console.error("perfil não encontrado");
      process.exit(2);
    }
    uid = p.id;
  } else {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,investor_balance_cents,demo_balance_provider_cents&id=eq.${encodeURIComponent(uid)}`
    );
    p = Array.isArray(rows) && rows[0];
  }
  console.log("    ", p.id, p.full_name);

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const apostador = real + reembolso + n(p.demo_balance_cents);
  console.log("\n==> Carteiras");
  console.log("    Apostador :", money(apostador));
  console.log("    Real      :", money(real));
  console.log(
    "    Reembolso :",
    money(reembolso),
    reembolso === EXPECTED_REEMBOLSO ? "✓ bate admin" : `≠ admin ${money(EXPECTED_REEMBOLSO)}`
  );
  console.log("    Desafio   :", money(p.desafio_balance_cents));
  console.log(
    "    Provedor  :",
    money(n(p.investor_balance_cents) + n(p.demo_balance_provider_cents))
  );

  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,platform_deduction_cents,settled_outcome,settled_at,created_at,metadata,odd&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=300`
  );
  const byId = {};
  for (const r of Array.isArray(prots) ? prots : []) byId[r.id] = r;

  const settles = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&type=eq.protection_settlement&order=created_at.asc&limit=300`
  );

  let sumEx = 0,
    sumArbi = 0,
    sumOther = 0;
  let indevidoFeeUp = 0;
  let legadoEx = 0;

  console.log("\n==> protection_settlement positivos");
  for (const t of Array.isArray(settles) ? settles : []) {
    const amt = n(t.amount_cents);
    if (amt <= 0) continue;
    const m = metaOf(t);
    const o = String(m.outcome || "").toLowerCase();
    const protId = String(t.ref || m.protection_id || "");
    const prot = byId[protId];
    const pout = prot ? outcomeOf(prot) : "?";
    const feeUp = prot ? isFeeUpfront(prot) : null;
    const billing = m.billing_model || (prot && metaOf(prot).billing_model) || "-";
    const bucket = m.bucket || "-";
    const stake = prot ? n(prot.responsibility_cents || prot.amount_cents) : 0;

    let klass = "OUTRO";
    if (o === "arbishield" || o === "lost_exchange" || pout === "arbishield") {
      klass = "ARBI";
      sumArbi += amt;
    } else if (o === "exchange" || o === "won_exchange" || pout === "exchange") {
      klass = "EXCHANGE";
      sumEx += amt;
      if (feeUp) indevidoFeeUp += amt;
      else legadoEx += amt;
    } else {
      sumOther += amt;
    }

    console.log(
      `    ${t.created_at} ${klass.padEnd(8)} ${money(amt).padStart(12)} txOut=${o || "-"} protOut=${pout} feeUp=${feeUp === null ? "?" : feeUp ? "Y" : "N"} billing=${billing} bucket=${bucket} stake=${money(stake)} ref=${protId.slice(0, 8)}`
    );
  }

  console.log("\n==> Somas");
  console.log("    EXCHANGE :", money(sumEx), `(fee_upfront indevido ${money(indevidoFeeUp)} | legado ${money(legadoEx)})`);
  console.log("    ARBI     :", money(sumArbi));
  console.log("    OUTRO    :", money(sumOther));
  console.log("    Reembolso atual:", money(reembolso));

  // Saques reembolso
  const wds = await sb(
    `/rest/v1/withdrawals?select=id,amount_cents,status,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=30`
  );
  console.log("\n==> Saques");
  let wdReemb = 0;
  for (const w of Array.isArray(wds) ? wds : []) {
    const m = metaOf(w);
    const origin = String(m.origin || m.label || "").toUpperCase();
    const isReemb =
      origin.includes("REEMBOLSO") ||
      origin.includes("DEDUCTION") ||
      origin.includes("DEDUCAO");
    if (isReemb) wdReemb += n(w.amount_cents);
    console.log(
      `    ${w.created_at} ${String(w.status).padEnd(12)} ${money(w.amount_cents)} reemb=${isReemb ? "Y" : "N"} origin=${origin || "-"}`
    );
  }

  console.log("\n==> Diagnóstico (mesmo padrão Lucas/Augusto)");
  if (sumEx > 0 && reembolso > 0) {
    console.log(
      "    !! Padrão similar: há settles EXCHANGE no ledger e Reembolso > 0"
    );
    console.log(
      "    Regra fee_upfront: PERDEU não credita. Residual no Reembolso provavelmente bucket errado."
    );
  }
  if (sumArbi > 0) {
    console.log(
      "    Arbi settles",
      money(sumArbi),
      "− saques reembolso",
      money(wdReemb),
      "≈ esperado residual",
      money(Math.max(0, sumArbi - wdReemb))
    );
    console.log(
      "    vs Reembolso atual",
      money(reembolso),
      Math.abs(reembolso - Math.max(0, sumArbi - wdReemb)) <= 100
        ? "≈ bate (legítimo Arbi)"
        : "≠ — parte pode ser Exchange/legado"
    );
  }
  if (reembolso === EXPECTED_REEMBOLSO && sumEx > 0 && sumArbi === 0) {
    console.log(
      "    → Reembolso R$ 750 muito provavelmente 100% crédito Exchange/legado indevido"
    );
  }
  if (reembolso > 0 && sumArbi === 0 && sumEx > 0) {
    console.log(
      "\n==> Correção sugerida (como Augusto/Lucas):"
    );
    console.log(
      "    Mover",
      money(reembolso),
      "Reembolso → Real (net Apostador igual)"
    );
    console.log(
      "    FIX=1 bash scripts/vps-correcao-reembolso-pedro.sh"
    );
  } else if (reembolso > Math.max(0, sumArbi - wdReemb) + 100) {
    const excess = reembolso - Math.max(0, sumArbi - wdReemb);
    console.log(
      "\n==> Correção sugerida: mover excesso",
      money(excess),
      "Reembolso → Real (manter residual Arbi legítimo)"
    );
  }

  console.log("\n(fim rastreio Pedro)");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
