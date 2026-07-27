#!/usr/bin/env node
/**
 * Auditoria GLOBAL — clientes com inconsistência Saldo Reembolso
 * (mesmo bug Lucas / Augusto / Pedro: settle Exchange creditando Reembolso)
 *
 * Relatório:
 *   node scripts/vps-audit-reembolso-inconsistencia-global.mjs
 *
 * Marker: vps-audit-reembolso-inconsistencia-global-v1
 */
import fs from "node:fs";
import path from "node:path";

const MIN_REEMBOLSO_CENTS = Math.round(
  Number(process.env.MIN_REEMBOLSO_CENTS || 1)
); // lista quem tem Reembolso > 0
const LIMIT = Math.min(5000, Math.max(50, Number(process.env.LIMIT || 2000)));
const ONLY_SUSPECTS =
  process.env.ONLY_SUSPECTS !== "0" && process.env.ONLY_SUSPECTS !== "false";

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

async function sbPaged(basePath, { pageSize = 1000, maxRows = LIMIT } = {}) {
  const out = [];
  let from = 0;
  while (out.length < maxRows) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const sep = basePath.includes("?") ? "&" : "?";
    const rows = await sb(`${basePath}${sep}limit=${pageSize}&offset=${from}`);
    // Prefer Range header style if supported — PostgREST also accepts offset
    const batch = Array.isArray(rows) ? rows : [];
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function classifyOutcome(meta) {
  const o = String(meta.outcome || "").toLowerCase();
  if (o === "arbishield" || o === "lost_exchange") return "arbishield";
  if (o === "exchange" || o === "won_exchange") return "exchange";
  return "other";
}

function isReembolsoWithdrawal(w) {
  const m = metaOf(w);
  const origin = String(m.origin || m.request_type || m.label || "").toUpperCase();
  return (
    origin.includes("REEMBOLSO") ||
    origin.includes("DEDUCTION") ||
    origin.includes("DEDUCAO") ||
    origin.includes("REFUND_BALANCE")
  );
}

async function main() {
  console.log("==> Auditoria GLOBAL — inconsistência Saldo Reembolso");
  console.log("    marker: vps-audit-reembolso-inconsistencia-global-v1");
  console.log("    MIN_REEMBOLSO_CENTS:", MIN_REEMBOLSO_CENTS);
  console.log("    ONLY_SUSPECTS:", ONLY_SUSPECTS);
  console.log("    LIMIT:", LIMIT);

  // 1) Profiles com Reembolso > 0
  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,account_status&deduction_balance_cents=gte.${MIN_REEMBOLSO_CENTS}&order=deduction_balance_cents.desc&limit=${LIMIT}`
  );
  const list = Array.isArray(profiles) ? profiles : [];
  console.log("\n==> Clientes com Saldo Reembolso > 0:", list.length);

  if (!list.length) {
    console.log("Nenhum. Fim.");
    return;
  }

  const ids = list.map((p) => p.id);
  const idSet = new Set(ids);

  // 2) Settlements positivos desses usuários (paginado por chunks de ids)
  console.log("==> Carregando protection_settlement…");
  const settleByUser = new Map(); // uid -> { arbi, exchange, other, txs: [] }
  const chunkSize = 40;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const inList = chunk.map((id) => `"${id}"`).join(",");
    const rows = await sb(
      `/rest/v1/wallet_transactions?select=user_id,amount_cents,metadata,ref,created_at&user_id=in.(${inList})&type=eq.protection_settlement&amount_cents=gt.0&order=created_at.asc&limit=5000`
    );
    for (const t of Array.isArray(rows) ? rows : []) {
      const uid = t.user_id;
      if (!idSet.has(uid)) continue;
      if (!settleByUser.has(uid)) {
        settleByUser.set(uid, { arbi: 0, exchange: 0, other: 0, nEx: 0, nArbi: 0 });
      }
      const bag = settleByUser.get(uid);
      const amt = n(t.amount_cents);
      const klass = classifyOutcome(metaOf(t));
      if (klass === "arbishield") {
        bag.arbi += amt;
        bag.nArbi += 1;
      } else if (klass === "exchange") {
        bag.exchange += amt;
        bag.nEx += 1;
      } else {
        bag.other += amt;
      }
    }
  }

  // 3) Saques de Reembolso
  console.log("==> Carregando withdrawals…");
  const wdByUser = new Map();
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const inList = chunk.map((id) => `"${id}"`).join(",");
    const rows = await sb(
      `/rest/v1/withdrawals?select=user_id,amount_cents,status,metadata&user_id=in.(${inList})&limit=5000`
    );
    for (const w of Array.isArray(rows) ? rows : []) {
      const st = String(w.status || "").toLowerCase();
      if (["rejected", "cancelled", "canceled"].includes(st)) continue;
      if (!isReembolsoWithdrawal(w)) continue;
      wdByUser.set(w.user_id, (wdByUser.get(w.user_id) || 0) + n(w.amount_cents));
    }
  }

  // 4) Classificar
  const suspects = [];
  const okArbi = [];
  const unknown = [];

  for (const p of list) {
    const reembolso = n(p.deduction_balance_cents);
    const real = n(p.balance_cents) + n(p.reusable_balance_cents);
    const bag = settleByUser.get(p.id) || {
      arbi: 0,
      exchange: 0,
      other: 0,
      nEx: 0,
      nArbi: 0,
    };
    const wd = wdByUser.get(p.id) || 0;
    const keepArbi = Math.max(0, bag.arbi - wd);
    const excess = Math.max(0, reembolso - keepArbi);

    const row = {
      id: p.id,
      name: p.full_name || "(sem nome)",
      reembolso,
      real,
      apostador: real + reembolso + n(p.demo_balance_cents),
      arbi: bag.arbi,
      exchange: bag.exchange,
      other: bag.other,
      nEx: bag.nEx,
      nArbi: bag.nArbi,
      wd,
      keepArbi,
      excess,
    };

    // Suspeito se:
    // - tem crédito Exchange no ledger E reembolso > residual Arbi, OU
    // - reembolso > 0 com exchange > 0 e arbi == 0, OU
    // - excess > 0 (reembolso acima do Arbi líquido)
    const suspeito =
      excess >= 100 || // >= R$ 1,00
      (bag.exchange > 0 && reembolso > keepArbi + 50) ||
      (bag.exchange > 0 && bag.arbi === 0 && reembolso > 0);

    if (suspeito) suspects.push(row);
    else if (bag.arbi > 0 && excess < 100) okArbi.push(row);
    else unknown.push(row);
  }

  suspects.sort((a, b) => b.excess - a.excess || b.exchange - a.exchange);

  console.log("\n================================================================");
  console.log(" SUSPEITOS (mesmo padrão Lucas/Augusto/Pedro)");
  console.log(" Reembolso > residual Arbi legítimo  e/ou  settles Exchange");
  console.log("================================================================");
  console.log(
    "n=",
    suspects.length,
    "| excesso total a mover ≈",
    money(suspects.reduce((s, r) => s + r.excess, 0))
  );
  console.log("");

  if (!suspects.length) {
    console.log("(nenhum suspeito com excesso ≥ R$ 1,00)");
  } else {
    console.log(
      [
        "nome".padEnd(36),
        "id8".padEnd(10),
        "reemb".padStart(12),
        "arbi".padStart(12),
        "exch".padStart(12),
        "saqueR".padStart(10),
        "keep".padStart(10),
        "EXCESSO".padStart(12),
      ].join(" ")
    );
    console.log("-".repeat(120));
    for (const r of suspects) {
      console.log(
        [
          String(r.name).slice(0, 36).padEnd(36),
          String(r.id).slice(0, 8).padEnd(10),
          money(r.reembolso).padStart(12),
          money(r.arbi).padStart(12),
          money(r.exchange).padStart(12),
          money(r.wd).padStart(10),
          money(r.keepArbi).padStart(10),
          money(r.excess).padStart(12),
        ].join(" ")
      );
    }
  }

  if (!ONLY_SUSPECTS) {
    console.log("\n==> OK (Reembolso ≈ Arbi líquido):", okArbi.length);
    console.log("==> Outros / sem settle classificado:", unknown.length);
  }

  // Destaque casos conhecidos
  console.log("\n==> Casos já tratados / referência");
  const known = [
    { prefix: "1210f201", label: "Lucas" },
    { prefix: "8b2cd8a3", label: "Augusto" },
    { prefix: "24037bdf", label: "Pedro Iuri" },
  ];
  for (const k of known) {
    const hit =
      suspects.find((r) => r.id.startsWith(k.prefix)) ||
      list.find((p) => String(p.id).startsWith(k.prefix));
    if (hit) {
      const r =
        suspects.find((x) => x.id.startsWith(k.prefix)) ||
        (() => {
          const p = list.find((x) => String(x.id).startsWith(k.prefix));
          const bag = settleByUser.get(p.id) || { arbi: 0, exchange: 0 };
          const wd = wdByUser.get(p.id) || 0;
          const reembolso = n(p.deduction_balance_cents);
          const keepArbi = Math.max(0, bag.arbi - wd);
          return {
            reembolso,
            excess: Math.max(0, reembolso - keepArbi),
            arbi: bag.arbi,
            exchange: bag.exchange,
          };
        })();
      console.log(
        `    ${k.label}: reemb=${money(r.reembolso)} excesso=${money(r.excess)} arbi=${money(r.arbi)} exch=${money(r.exchange)}`
      );
    } else {
      console.log(`    ${k.label}: não listado (Reembolso 0 ou fora do filtro)`);
    }
  }

  console.log("\n==> Próximo passo");
  console.log("    Para cada suspeito com EXCESSO > 0:");
  console.log("      mover excesso Reembolso → Real (preservar keep Arbi)");
  console.log("    Scripts por cliente ou batch:");
  console.log("      FIX=1 NAME=\"...\" ID_PREFIX=... node scripts/vps-correcao-reembolso-cliente.mjs");
  console.log("\n(fim auditoria global — sem FIX automático)");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
