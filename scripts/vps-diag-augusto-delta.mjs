#!/usr/bin/env node
/**
 * Diagnóstico profundo — Augusto (delta Apostador).
 * Quebra admin/settles/saques por bucket e recalcula teórico Real+Reembolso.
 *
 * Marker: vps-diag-augusto-delta-v1
 */
import fs from "node:fs";
import path from "node:path";

const USER_ID = String(
  process.env.USER_ID || ""
).trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "8b2cd8a3")
  .trim()
  .toLowerCase();
const NAME = String(
  process.env.NAME || "Augusto Luiz Magalhaes Vila Nova"
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
  if (st === "void") return "void";
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
    method: "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 320)}`);
  return data;
}

async function resolveUser() {
  if (USER_ID) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,investor_balance_cents,demo_balance_provider_cents,locked_balance_cents&id=eq.${encodeURIComponent(USER_ID)}`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,investor_balance_cents,demo_balance_provider_cents,locked_balance_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
  );
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    console.error("ERRO: perfil não encontrado");
    process.exit(2);
  }
  return list[0];
}

function bucketHint(t) {
  const m = metaOf(t);
  const b = String(
    m.bucket || m.to_bucket || m.from_bucket || m.destination || m.origin || ""
  ).toLowerCase();
  if (b.includes("desafio")) return "desafio";
  if (b.includes("deduction") || b.includes("reembolso")) return "reembolso";
  if (b.includes("investor") || b.includes("provider") || b.includes("provedor"))
    return "provedor";
  if (b.includes("demo")) return "demo";
  if (b.includes("balance") || b.includes("real") || b.includes("apostador"))
    return "real";
  const note = String(m.note || m.reason || m.kind || m.label || "").toLowerCase();
  if (note.includes("desafio")) return "desafio";
  if (note.includes("reembolso") || note.includes("deduction")) return "reembolso";
  if (note.includes("provedor") || note.includes("investor")) return "provedor";
  return "desconhecido";
}

async function main() {
  console.log("==> Diagnóstico delta Augusto");
  console.log("    marker: vps-diag-augusto-delta-v1");
  console.log("    NAME:", NAME);

  const p = await resolveUser();
  const uid = p.id;
  console.log("    id:", uid, p.full_name);

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const apostador = real + reembolso + n(p.demo_balance_cents);

  console.log("\n==> Carteiras");
  console.log("    Real     :", money(real));
  console.log("    Reembolso:", money(reembolso));
  console.log("    Apostador:", money(apostador));
  console.log("    Desafio  :", money(p.desafio_balance_cents));
  console.log("    Provedor :", money(n(p.investor_balance_cents) + n(p.demo_balance_provider_cents)));

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=1000`
  );
  const allTx = Array.isArray(txs) ? txs : [];

  // Admin por bucket
  console.log("\n==> admin_adjustment por bucket (inferido)");
  const adminBy = { real: 0, reembolso: 0, desafio: 0, provedor: 0, demo: 0, desconhecido: 0 };
  for (const t of allTx) {
    if (String(t.type) !== "admin_adjustment") continue;
    const b = bucketHint(t);
    adminBy[b] = (adminBy[b] || 0) + n(t.amount_cents);
    console.log(
      `    ${t.created_at} ${money(t.amount_cents).padStart(12)} → ${b}  kind=${metaOf(t).kind || metaOf(t).reason || metaOf(t).note || "-"}`
    );
  }
  console.log("    totais:", Object.fromEntries(Object.entries(adminBy).map(([k, v]) => [k, money(v)])));

  // Settlements detalhados
  console.log("\n==> protection_settlement");
  let settleArbi = 0;
  let settleExch = 0;
  let settleOther = 0;
  for (const t of allTx) {
    if (String(t.type) !== "protection_settlement") continue;
    const m = metaOf(t);
    const o = String(m.outcome || "").toLowerCase();
    const amt = n(t.amount_cents);
    console.log(
      `    ${t.created_at} ${money(amt).padStart(12)} outcome=${o || "-"} billing=${m.billing_model || "-"} bucket=${m.bucket || "-"} ref=${String(t.ref || "").slice(0, 8)}`
    );
    if (amt <= 0) continue;
    if (o === "arbishield" || o === "lost_exchange") settleArbi += amt;
    else if (o === "exchange" || o === "won_exchange") settleExch += amt;
    else settleOther += amt;
  }
  console.log("    +Arbi:", money(settleArbi), "| +Exchange:", money(settleExch), "| +outro:", money(settleOther));

  // Fees
  console.log("\n==> protection_fee");
  let fees = 0;
  for (const t of allTx) {
    if (String(t.type) !== "protection_fee") continue;
    fees += n(t.amount_cents);
    console.log(`    ${t.created_at} ${money(t.amount_cents)} ref=${String(t.ref || "").slice(0, 8)}`);
  }
  console.log("    soma fees:", money(fees));

  // Deposits
  let deps = 0;
  console.log("\n==> depósitos (ledger)");
  for (const t of allTx) {
    const type = String(t.type || "");
    if (!(type.includes("deposit") || type === "manual_deposit" || type === "asaas_deposit"))
      continue;
    deps += n(t.amount_cents);
    console.log(`    ${t.created_at} ${type} ${money(t.amount_cents)}`);
  }
  console.log("    soma:", money(deps));

  // Withdrawals
  console.log("\n==> saques / withdrawal_*");
  let wd = 0;
  for (const t of allTx) {
    const type = String(t.type || "");
    if (!type.includes("withdraw")) continue;
    wd += n(t.amount_cents);
    console.log(
      `    ${t.created_at} ${type} ${money(t.amount_cents)} origin=${metaOf(t).origin || metaOf(t).bucket || "-"}`
    );
  }
  console.log("    soma:", money(wd));

  // Protections summary
  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,platform_deduction_cents,settled_outcome,settled_at,created_at,metadata,odd&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=200`
  );
  const protections = Array.isArray(prots) ? prots : [];
  console.log("\n==> Proteções settled — classificação");
  let missingFee = 0;
  let exchIndev = 0;
  let arbiOk = 0;
  for (const row of protections) {
    const out = outcomeOf(row);
    if (!row.settled_at && !["won_exchange", "lost_exchange", "void", "settled"].includes(String(row.status || "").toLowerCase()))
      continue;
    const stake = n(row.responsibility_cents || row.amount_cents);
    const feeUp = isFeeUpfront(row);
    const feeTx = allTx.filter(
      (t) =>
        String(t.type) === "protection_fee" &&
        (String(t.ref) === String(row.id) ||
          String(metaOf(t).protection_id || "") === String(row.id))
    );
    const feePaid = feeTx.reduce((s, t) => s + Math.abs(n(t.amount_cents)), 0);
    const settleTx = allTx.filter(
      (t) =>
        String(t.type) === "protection_settlement" &&
        (String(t.ref) === String(row.id) ||
          String(metaOf(t).protection_id || "") === String(row.id))
    );
    const settleAmt = settleTx.reduce((s, t) => s + n(t.amount_cents), 0);
    const flag =
      feeUp && out === "exchange" && settleAmt > 0
        ? "CREDIT_INDEVIDO"
        : feeUp && feePaid === 0 && n(row.platform_deduction_cents || metaOf(row).fee_charged_cents) > 0
          ? "FEE_FALTANDO"
          : feeUp && feePaid === 0 && settleAmt === 0 && out === "exchange"
            ? "PERDEU_SEM_FEE"
            : out === "arbishield"
              ? "ARBI_OK?"
              : "ok";
    if (flag === "CREDIT_INDEVIDO") exchIndev += settleAmt;
    if (flag === "FEE_FALTANDO" || flag === "PERDEU_SEM_FEE") {
      const exp = n(row.platform_deduction_cents || metaOf(row).fee_charged_cents);
      missingFee += exp;
    }
    if (out === "arbishield") arbiOk += settleAmt;
    console.log(
      `    ${String(row.id).slice(0, 8)}… ${out.padEnd(10)} stake=${money(stake)} feePaid=${money(feePaid)} settle=${money(settleAmt)} feeUp=${feeUp ? "Y" : "N"} [${flag}]`
    );
  }

  // Teórico Apostador CORRETO: só o que afeta Real+Reembolso+demo
  const adminApostador = adminBy.real + adminBy.reembolso + adminBy.demo + adminBy.desconhecido;
  // Settles positivos vão para Reembolso (afetam Apostador). Exchange indevido também.
  const settleApostador = settleArbi + settleExch + settleOther;
  // Saque do Reembolso/Real debita Apostador. Saque Desafio não.
  // Sem metadado fino, usamos todos withdrawal_* do ledger (como a 1ª auditoria).
  const teorico =
    deps + fees + adminApostador + settleApostador + wd;

  console.log("\n==> Teórico Apostador RECALCULADO (admin só real/reembolso/demo/??)");
  console.log("    depósitos          :", money(deps));
  console.log("    fees               :", money(fees));
  console.log("    admin→Apostador    :", money(adminApostador), `(desafio ${money(adminBy.desafio)} excluído)`);
  console.log("    settles +          :", money(settleApostador), `(Arbi ${money(settleArbi)} + Exch ${money(settleExch)} + out ${money(settleOther)})`);
  console.log("    saques ledger      :", money(wd));
  console.log("    = teórico          :", money(teorico));
  console.log("    Apostador atual    :", money(apostador));
  console.log("    delta              :", money(apostador - teorico));

  console.log("\n==> Achados rápidos");
  console.log("    créditos Exchange indevidos (settle):", money(exchIndev));
  console.log("    fees faltantes (coluna):", money(missingFee));
  console.log("    Reembolso atual:", money(reembolso));
  console.log("    Settles Arbi no ledger:", money(settleArbi));

  if (Math.abs(apostador - teorico) > 100) {
    console.log("\n    → Ainda há buraco. Possíveis causas:");
    console.log("      1) admin_adjustment sem bucket (foi p/ Desafio mas contou no Apostador teórico)");
    console.log("      2) transferência Real↔Desafio não refletida no tipo da tx");
    console.log("      3) clawback/settle sem wallet_tx / tx duplicada");
    console.log("      4) saque pendente já debitou Reembolso (ex.: 255,51) mas teórico somou settle+saque errado");
  }

  // Caso clássico: settle Arbi 255,51 depois saque 255,51 do Reembolso → Reembolso sobra só o que sobrou
  console.log("\n==> Hipótese saque Reembolso");
  console.log("    Se saque pendente R$ 255,51 saiu do Reembolso após settle Arbi,");
  console.log("    Reembolso esperado residual ≈ settles - saque_reembolso + ajustes");
  console.log("    Reembolso agora:", money(reembolso));
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
