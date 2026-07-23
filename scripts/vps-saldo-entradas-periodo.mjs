#!/usr/bin/env node
/**
 * Relatório de entradas/movimentações por período (VPS + SERVICE_ROLE).
 *
 *   FROM=2026-07-19 NAME="LUIZ PAULO" node scripts/vps-saldo-entradas-periodo.mjs
 *   FROM=2026-07-19 ID_PREFIX=b6eb155d node scripts/vps-saldo-entradas-periodo.mjs
 *   FROM=2026-07-19 TO=2026-07-22 USER_ID=... node scripts/vps-saldo-entradas-periodo.mjs
 */
import fs from "node:fs";
import path from "node:path";

const EMAIL = String(process.env.EMAIL || "").trim().toLowerCase();
const USER_ID = String(process.env.USER_ID || process.env.ID || "").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "").trim().toLowerCase();
const NAME = String(process.env.NAME || process.env.FULL_NAME || "").trim();
const FROM = String(process.env.FROM || "2026-07-19").trim();
const TO = String(process.env.TO || "").trim(); // vazio = agora

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
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
if (!EMAIL && !USER_ID && !ID_PREFIX && !NAME) {
  console.error("Informe EMAIL / USER_ID / ID_PREFIX / NAME");
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

function periodBounds() {
  // FROM início do dia America/Sao_Paulo ≈ 03:00 UTC no horário de Brasília padrão
  const fromIso = new Date(`${FROM}T00:00:00-03:00`).toISOString();
  let toIso;
  if (TO) {
    toIso = new Date(`${TO}T23:59:59.999-03:00`).toISOString();
  } else {
    toIso = new Date().toISOString();
  }
  return { fromIso, toIso };
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 240)}`);
  return data;
}

async function resolveUserId() {
  if (USER_ID) return USER_ID;

  if (ID_PREFIX) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents&order=created_at.desc&limit=5000`
    );
    const list = (Array.isArray(rows) ? rows : []).filter((r) =>
      String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
    );
    if (!list.length) throw new Error(`sem profile id~${ID_PREFIX}`);
    if (list.length > 1) {
      console.log("Matches ID_PREFIX:");
      list.forEach((r) =>
        console.log(`  ${r.id}  ${r.full_name || "—"}  ${money(r.balance_cents)}`)
      );
    }
    return list[0].id;
  }

  if (NAME) {
    const q = encodeURIComponent("%" + NAME + "%");
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,account_status&full_name=ilike.${q}&order=created_at.desc&limit=20`
    );
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) throw new Error(`sem profile nome~${NAME}`);
    if (list.length > 1) {
      console.log(`Matches NAME="${NAME}":`);
      list.forEach((r) =>
        console.log(
          `  ${r.id}  ${r.full_name || "—"}  ${r.account_status || "—"}  ${money(r.balance_cents)}`
        )
      );
    }
    return list[0].id;
  }

  // EMAIL via auth admin
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      }
    );
    const data = await res.json();
    const users = data?.users || data || [];
    if (!Array.isArray(users) || !users.length) break;
    const hit = users.find(
      (u) => String(u.email || "").toLowerCase() === EMAIL
    );
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  throw new Error(`auth sem email=${EMAIL}`);
}

const CREDIT_TYPES = new Set([
  "deposit",
  "manual_credit",
  "asaas_deposit",
  "protection_refund",
  "protection_unlock",
  "protection_settlement",
  "bonus",
  "affiliate_credit",
  "balance_correction",
]);

async function main() {
  const { fromIso, toIso } = periodBounds();
  console.log("==> Entradas / movimentações no período");
  console.log(`    FROM ${FROM} (${fromIso})`);
  console.log(`    TO   ${TO || "agora"} (${toIso})`);

  const id = await resolveUserId();
  const prof = await sb(
    `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents,demo_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  console.log("    user:", id);
  console.log("    nome:", p?.full_name || "—");
  console.log("    status:", p?.account_status || "—");
  console.log(
    "    balance_cents agora:",
    money(p?.balance_cents),
    "| reusable:",
    money(p?.reusable_balance_cents),
    "| demo:",
    money(p?.demo_balance_cents)
  );

  const gte = encodeURIComponent(fromIso);
  const lte = encodeURIComponent(toIso);

  // Depósitos manuais
  console.log("\n==> manual_deposits no período");
  const deps = await sb(
    `/rest/v1/manual_deposits?select=id,amount_cents,status,network,deposit_type,admin_notes,created_at,updated_at&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=200`
  );
  let depApproved = 0;
  let depPending = 0;
  for (const d of Array.isArray(deps) ? deps : []) {
    const st = String(d.status || "").toUpperCase();
    if (st === "APPROVED") depApproved += n(d.amount_cents);
    if (st === "PENDING" || st === "PENDING_REVIEW") depPending += n(d.amount_cents);
    console.log(
      `  ${d.created_at}  ${String(d.status).padEnd(14)} ${money(d.amount_cents)}  ${d.network || "—"}  ${d.deposit_type || ""}  ${(d.admin_notes || "").toString().slice(0, 40)}`
    );
  }
  if (!Array.isArray(deps) || !deps.length) console.log("  (nenhum)");
  console.log(`  soma APPROVED: ${money(depApproved)}`);
  console.log(`  soma PENDING:  ${money(depPending)}`);

  // Asaas (se existir)
  console.log("\n==> asaas_payments no período (se tabela existir)");
  try {
    const asaas = await sb(
      `/rest/v1/asaas_payments?select=id,amount_cents,status,created_at,user_id&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=100`
    );
    let asaasOk = 0;
    for (const a of Array.isArray(asaas) ? asaas : []) {
      const st = String(a.status || "").toLowerCase();
      if (st === "confirmed" || st === "received" || st === "paid") {
        asaasOk += n(a.amount_cents);
      }
      console.log(
        `  ${a.created_at}  ${String(a.status).padEnd(14)} ${money(a.amount_cents)}`
      );
    }
    if (!Array.isArray(asaas) || !asaas.length) console.log("  (nenhum)");
    console.log(`  soma confirmados: ${money(asaasOk)}`);
  } catch (e) {
    console.log("  (tabela indisponível)", e.message || e);
  }

  // Wallet transactions
  console.log("\n==> wallet_transactions no período");
  let txs = [];
  try {
    txs = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at,balance_after_cents&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=500`
    );
    if (!Array.isArray(txs)) txs = [];
  } catch (e) {
    try {
      txs = await sb(
        `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=500`
      );
      if (!Array.isArray(txs)) txs = [];
    } catch (e2) {
      console.log("  falhou:", e2.message || e2);
      txs = [];
    }
  }

  const byType = new Map();
  let creditSum = 0;
  let debitSum = 0;
  for (const t of txs) {
    const ty = String(t.type || "?");
    const amt = n(t.amount_cents);
    byType.set(ty, (byType.get(ty) || 0) + amt);
    if (amt >= 0 || CREDIT_TYPES.has(ty.toLowerCase())) {
      if (amt > 0) creditSum += amt;
      else if (amt < 0) debitSum += amt;
      else creditSum += amt;
    } else {
      debitSum += amt;
    }
    // classificação simples: positivo = entrada
    if (amt > 0) {
      /* already in creditSum if > 0 */
    }
  }
  // Recalcula entradas/saídas pelo sinal (mais confiável)
  creditSum = txs.filter((t) => n(t.amount_cents) > 0).reduce((a, t) => a + n(t.amount_cents), 0);
  debitSum = txs.filter((t) => n(t.amount_cents) < 0).reduce((a, t) => a + n(t.amount_cents), 0);

  console.log("  por tipo:");
  for (const [ty, sum] of [...byType.entries()].sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  )) {
    const tag = n(sum) > 0 ? "ENTRADA" : n(sum) < 0 ? "SAÍDA" : "—";
    console.log(`    ${ty.padEnd(24)} ${money(sum).padStart(14)}  ${tag}`);
  }
  console.log(`  TOTAL ENTRADAS (>0): ${money(creditSum)}`);
  console.log(`  TOTAL SAÍDAS   (<0): ${money(debitSum)}`);
  console.log(`  NET período:         ${money(creditSum + debitSum)}`);
  console.log(`  lançamentos: ${txs.length}`);
  console.log("\n  detalhe cronológico:");
  for (const t of txs) {
    const extra =
      t.metadata != null
        ? JSON.stringify(t.metadata).slice(0, 60)
        : t.ref || "";
    const sign = n(t.amount_cents) > 0 ? "+" : "";
    console.log(
      `  ${t.created_at}  ${String(t.type || "").padEnd(22)} ${sign}${money(t.amount_cents)}  ${extra}`
    );
  }
  if (!txs.length) console.log("  (nenhuma tx no período)");

  // Proteções criadas no período
  console.log("\n==> protections criadas no período");
  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,result,created_at,settled_at&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=200`
  );
  for (const r of Array.isArray(prots) ? prots : []) {
    console.log(
      `  ${r.created_at}  ${String(r.status).padEnd(14)} ${money(r.amount_cents)}  ${r.result || "—"}  ${String(r.id).slice(0, 8)}`
    );
  }
  if (!Array.isArray(prots) || !prots.length) console.log("  (nenhuma)");

  console.log("\n==> Resumo entradas 19/07→hoje");
  console.log(`  Depósitos manuais APPROVED: ${money(depApproved)}`);
  console.log(`  Wallet créditos (amount>0): ${money(creditSum)}`);
  console.log(`  Wallet débitos  (amount<0): ${money(debitSum)}`);
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
