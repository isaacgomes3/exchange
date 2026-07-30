#!/usr/bin/env node
/**
 * Conta interações (proteções criadas) DEPOIS da fixação stake_lock/v10 anteontem
 * e mostra qual billing_model o sistema gravou (stake_lock_v1 vs fee_upfront_v1).
 *
 * Janela padrão: desde 2026-07-28 00:00 UTC (fim da noite que reverteu fee_upfront v11)
 * até agora.
 *
 * Na VPS:
 *   node scripts/vps-contar-interacoes-pos-trava-v10.mjs
 *   SINCE=2026-07-27T23:39:00Z node ...
 *
 * Marker: vps-contar-interacoes-pos-trava-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SINCE = String(
  process.env.SINCE || "2026-07-28T00:00:00.000Z"
).trim();
const UNTIL = String(process.env.UNTIL || new Date().toISOString()).trim();

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

function billingOf(row) {
  const m = metaOf(row);
  if (m.billing_model) return String(m.billing_model);
  if (m.fee_upfront === true || m.fee_upfront === "true") return "fee_upfront_v1";
  if (m.stake_lock === true || m.stake_lock === "true") return "stake_lock_v1";
  return "(sem marker)";
}

async function sb(p) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
    },
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

async function loadTable(table) {
  const q =
    `/rest/v1/${table}?select=id,user_id,match_id,status,settled_outcome,amount_cents,responsibility_cents,odd,metadata,created_at` +
    `&created_at=gte.${encodeURIComponent(SINCE)}` +
    `&created_at=lte.${encodeURIComponent(UNTIL)}` +
    `&order=created_at.asc&limit=2000`;
  const rows = await sb(q);
  return Array.isArray(rows) ? rows : [];
}

async function nameOf(uid) {
  const rows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=full_name&limit=1`
  );
  return rows?.[0]?.full_name || String(uid).slice(0, 8);
}

async function main() {
  console.log("==> Interações no sistema APÓS trava stake_lock/v10 (anteontem)");
  console.log("    janela:", SINCE, "→", UNTIL);
  console.log(
    "    marco código: revert fee_upfront v11 (c7bfdc3) 27/07 23:39 + docs v10"
  );

  // O que a API de produção declara agora
  try {
    const health = await fetch("http://127.0.0.1:3098/health", {
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.text());
    console.log("\n  health :3098 →", String(health).slice(0, 300));
    if (/fee_upfront|protection-fee-upfront/i.test(health)) {
      console.log("  ⚠ API ainda declara fee_upfront no health");
    }
    if (/stake_lock|protection-flow-contract-v10|stake-lock/i.test(health)) {
      console.log("  ✓ API menciona stake_lock / v10 no health");
    }
  } catch (e) {
    console.log("  (health :3098 indisponível neste host)", e.message || e);
  }

  const [lays, backs] = await Promise.all([
    loadTable("protections"),
    loadTable("back_protections").catch(() => []),
  ]);
  const all = [
    ...lays.map((r) => ({ ...r, _table: "protections" })),
    ...backs.map((r) => ({ ...r, _table: "back_protections" })),
  ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  console.log(`\n  total proteções criadas na janela: ${all.length}`);

  const byBilling = new Map();
  const byStatus = new Map();
  for (const r of all) {
    const b = billingOf(r);
    byBilling.set(b, (byBilling.get(b) || 0) + 1);
    const st = String(r.status || "?");
    byStatus.set(st, (byStatus.get(st) || 0) + 1);
  }

  console.log("\n==== POR MODELO (billing_model gravado) ====");
  for (const [k, v] of [...byBilling.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  console.log("\n==== POR STATUS ====");
  for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const feeUp = all.filter((r) => /fee_upfront/i.test(billingOf(r)));
  const stakeLock = all.filter((r) => /stake_lock/i.test(billingOf(r)));
  const unknown = all.filter(
    (r) => !/fee_upfront|stake_lock/i.test(billingOf(r))
  );

  console.log("\n==== RESUMO ====");
  console.log(`  stake_lock_v1:  ${stakeLock.length}`);
  console.log(`  fee_upfront_*:  ${feeUp.length}`);
  console.log(`  sem marker:     ${unknown.length}`);
  console.log(`  TOTAL:         ${all.length}`);

  if (feeUp.length) {
    console.log(
      "\n  ⚠ Houve proteções NOVAS com fee_upfront depois da trava stake_lock —"
    );
    console.log(
      "    a API/produção provavelmente continuou no modelo antigo nesse período."
    );
  }

  console.log("\n==== LISTA (até 40) ====");
  const show = all.slice(0, 40);
  for (const r of show) {
    let name = String(r.user_id).slice(0, 8);
    try {
      name = await nameOf(r.user_id);
    } catch {
      /* */
    }
    const amount = n(r.responsibility_cents || r.amount_cents);
    console.log(
      `  ${String(r.created_at).replace("T", " ").slice(0, 19)}  ${String(
        r.id
      ).slice(0, 8)}  ${billingOf(r).padEnd(16)}  ${String(r.status || "?").padEnd(
        14
      )}  ${money(amount)}  ${name}`
    );
  }
  if (all.length > 40) console.log(`  … +${all.length - 40} omitidas`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
