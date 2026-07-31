#!/usr/bin/env node
/**
 * Lista proteções AINDA ABERTAS e o billing_model gravado.
 * Serve para saber se jogos da grade podem liquidar fora do stake_lock_v1.
 *
 * Marker: vps-contar-protecoes-abertas-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  if (m.stake_lock === true || m.stake_lock === "true") return "stake_lock_v1";
  if (m.fee_upfront === true || m.fee_upfront === "true") return "fee_upfront_v1";
  return "(sem marker)";
}

async function sb(p) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
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
  if (!res.ok) {
    throw new Error(`${res.status} ${p}\n${String(text).slice(0, 600)}`);
  }
  return data;
}

async function nameOf(uid) {
  const rows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=full_name&limit=1`
  );
  return rows?.[0]?.full_name || String(uid).slice(0, 8);
}

const OPEN =
  "active,pending,open,locked,in_play,awaiting_result,awaiting_settlement";

async function loadOpen(table) {
  const q =
    `/rest/v1/${table}?select=id,user_id,match_id,status,amount_cents,responsibility_cents,metadata,created_at` +
    `&status=in.(${OPEN})` +
    `&order=created_at.desc&limit=500`;
  const rows = await sb(q);
  return Array.isArray(rows) ? rows : [];
}

async function main() {
  console.log("==> Proteções ABERTAS (risco de liquidar fora do stake_lock_v1)");
  try {
    const health = await fetch("http://127.0.0.1:3098/health", {
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.text());
    console.log("  health :3098 →", String(health).slice(0, 280));
    if (/createProtectionModel"\s*:\s*"stake_lock_v1/.test(health)) {
      console.log("  ✓ API cria novas proteções em stake_lock_v1");
    } else {
      console.log("  ⚠ API NÃO declara createProtectionModel=stake_lock_v1");
    }
  } catch (e) {
    console.log("  (health indisponível)", e.message || e);
  }

  const [lays, backs] = await Promise.all([
    loadOpen("protections"),
    loadOpen("back_protections").catch(() => []),
  ]);
  const all = [
    ...lays.map((r) => ({ ...r, _table: "LAY" })),
    ...backs.map((r) => ({ ...r, _table: "BACK" })),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const byBilling = new Map();
  for (const r of all) {
    const b = billingOf(r);
    byBilling.set(b, (byBilling.get(b) || 0) + 1);
  }

  console.log(`\n  total abertas: ${all.length}`);
  console.log("==== POR MODELO ====");
  for (const [k, v] of [...byBilling.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const bad = all.filter((r) => billingOf(r) !== "stake_lock_v1");
  if (!all.length) {
    console.log("\nOK — nenhuma proteção aberta. Grade sem bilhete pendente.");
  } else if (!bad.length) {
    console.log(
      "\nOK — todas as abertas estão em stake_lock_v1. Liquidação segue o fluxo v10."
    );
  } else {
    console.log(
      `\n⚠ ${bad.length} aberta(s) FORA de stake_lock_v1 — esses bilhetes liquidam pela regra da linha.`
    );
  }

  console.log("\n==== LISTA ====");
  for (const r of all.slice(0, 80)) {
    let name = String(r.user_id || "").slice(0, 8);
    try {
      name = await nameOf(r.user_id);
    } catch {
      /* */
    }
    const amount = Number(r.responsibility_cents || r.amount_cents || 0);
    console.log(
      `  ${String(r.created_at).replace("T", " ").slice(0, 19)}  ${String(
        r.id
      ).slice(0, 8)}  ${r._table.padEnd(4)}  ${billingOf(r).padEnd(16)}  ${String(
        r.status || "?"
      ).padEnd(14)}  ${money(amount)}  match=${String(r.match_id || "").slice(
        0,
        8
      )}  ${name}`
    );
  }
  if (all.length > 80) console.log(`  … +${all.length - 80} omitidas`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
