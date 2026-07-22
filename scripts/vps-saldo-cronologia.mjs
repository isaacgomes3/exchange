#!/usr/bin/env node
/**
 * Cronologia do saldo (reconstrução dia a dia / lançamento a lançamento).
 *
 *   FROM=2026-07-15 ID_PREFIX=b6eb155d node scripts/vps-saldo-cronologia.mjs
 *   FROM=2026-07-15 NAME="LUIZ PAULO" node scripts/vps-saldo-cronologia.mjs
 */
import fs from "node:fs";
import path from "node:path";

const EMAIL = String(process.env.EMAIL || "").trim().toLowerCase();
const USER_ID = String(process.env.USER_ID || process.env.ID || "").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "").trim().toLowerCase();
const NAME = String(process.env.NAME || process.env.FULL_NAME || "").trim();
const FROM = String(process.env.FROM || "2026-07-15").trim();
const TO = String(process.env.TO || "").trim();
const BUCKET = String(process.env.BUCKET || "balance_cents").trim(); // saldo principal ADM

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
function pad(s, w) {
  s = String(s ?? "");
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function periodBounds() {
  const fromIso = new Date(`${FROM}T00:00:00-03:00`).toISOString();
  const toIso = TO
    ? new Date(`${TO}T23:59:59.999-03:00`).toISOString()
    : new Date().toISOString();
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
          `  ${r.id}  ${r.full_name || "—"}  ${money(r.balance_cents)}`
        )
      );
    }
    return list[0].id;
  }
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

async function fetchAllTx(id, fromIso, toIso) {
  const gte = encodeURIComponent(fromIso);
  const lte = encodeURIComponent(toIso);
  const paths = [
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at,balance_after_cents&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=1000`,
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=1000`,
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=1000`,
  ];
  let lastErr = null;
  for (const p of paths) {
    try {
      const rows = await sb(p);
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("falha wallet_transactions");
}

async function fetchTxBefore(id, fromIso) {
  const lt = encodeURIComponent(fromIso);
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,balance_after_cents&user_id=eq.${encodeURIComponent(id)}&created_at=lt.${lt}&order=created_at.desc&limit=5`
    );
    return Array.isArray(rows) ? rows : [];
  } catch {
    try {
      const rows = await sb(
        `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at&user_id=eq.${encodeURIComponent(id)}&created_at=lt.${lt}&order=created_at.desc&limit=5`
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
}

async function main() {
  const { fromIso, toIso } = periodBounds();
  console.log("==> Cronologia do saldo");
  console.log(`    período: ${FROM} → ${TO || "agora"}`);
  console.log(`    UTC: ${fromIso} → ${toIso}`);

  const id = await resolveUserId();
  const prof = await sb(
    `/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) throw new Error("profile não encontrado");

  console.log("    user:", id);
  console.log("    nome:", p.full_name || "—");
  console.log("    status:", p.account_status || "—");
  console.log("\n==> Buckets atuais");
  for (const k of [
    "balance_cents",
    "reusable_balance_cents",
    "demo_balance_cents",
    "investor_balance_cents",
    "demo_balance_provider_cents",
    "desafio_balance_cents",
    "locked_balance_cents",
  ]) {
    console.log(`  ${k}: ${money(p[k])}`);
  }

  const before = await fetchTxBefore(id, fromIso);
  const txs = await fetchAllTx(id, fromIso, toIso);

  // Saldo inicial estimado:
  // 1) se a última tx ANTES do período tem balance_after_cents, usa
  // 2) senão: saldo atual - soma(amount no período)
  let opening = null;
  let openingSource = "";
  const lastBefore = before[0];
  if (lastBefore && lastBefore.balance_after_cents != null) {
    opening = n(lastBefore.balance_after_cents);
    openingSource = `balance_after da tx ${lastBefore.created_at} (${lastBefore.type})`;
  } else {
    const periodNet = txs.reduce((a, t) => a + n(t.amount_cents), 0);
    opening = n(p[BUCKET]) - periodNet;
    openingSource = `retrocalculado: ${BUCKET} atual (${money(p[BUCKET])}) − net período (${money(periodNet)})`;
  }

  console.log("\n==> Saldo de abertura em", FROM);
  console.log(`  ${money(opening)}  (${openingSource})`);

  // Depósitos no período (contexto)
  const gte = encodeURIComponent(fromIso);
  const lte = encodeURIComponent(toIso);
  console.log("\n==> Depósitos manuais no período (contexto)");
  try {
    const deps = await sb(
      `/rest/v1/manual_deposits?select=created_at,status,amount_cents,network,deposit_type&user_id=eq.${encodeURIComponent(id)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=200`
    );
    for (const d of Array.isArray(deps) ? deps : []) {
      console.log(
        `  ${d.created_at}  DEPÓSITO/${d.status}  ${money(d.amount_cents)}  ${d.network || ""} ${d.deposit_type || ""}`
      );
    }
    if (!Array.isArray(deps) || !deps.length) console.log("  (nenhum)");
  } catch (e) {
    console.log("  falhou:", e.message || e);
  }

  console.log("\n==> Cronologia wallet_transactions");
  console.log(
    pad("quando", 25) +
      pad("tipo", 24) +
      pad("movimento", 14) +
      pad("saldo_calc", 14) +
      pad("saldo_tx", 14) +
      "nota"
  );
  console.log("-".repeat(100));
  console.log(
    pad(FROM + " 00:00", 25) +
      pad("ABERTURA", 24) +
      pad("—", 14) +
      pad(money(opening), 14) +
      pad("—", 14) +
      openingSource.slice(0, 40)
  );

  let running = opening;
  let day = "";
  const byDay = new Map();

  for (const t of txs) {
    const amt = n(t.amount_cents);
    running += amt;
    const when = String(t.created_at || "");
    const d = when.slice(0, 10);
    if (d !== day) {
      day = d;
      console.log(`--- ${d} ---`);
    }
    if (!byDay.has(d)) byDay.set(d, { in: 0, out: 0, net: 0, n: 0 });
    const ag = byDay.get(d);
    ag.n += 1;
    ag.net += amt;
    if (amt > 0) ag.in += amt;
    if (amt < 0) ag.out += amt;

    const afterStored =
      t.balance_after_cents != null ? money(t.balance_after_cents) : "—";
    const mismatch =
      t.balance_after_cents != null &&
      Math.abs(n(t.balance_after_cents) - running) > 1
        ? `⚠ dif ${money(n(t.balance_after_cents) - running)}`
        : "";
    const meta =
      t.metadata != null
        ? JSON.stringify(t.metadata).slice(0, 36)
        : t.ref
          ? String(t.ref).slice(0, 36)
          : "";
    const mov = (amt > 0 ? "+" : "") + money(amt);
    console.log(
      pad(when.replace("T", " ").slice(0, 19), 25) +
        pad(t.type || "?", 24) +
        pad(mov, 14) +
        pad(money(running), 14) +
        pad(afterStored, 14) +
        `${mismatch} ${meta}`.trim()
    );
  }

  console.log("-".repeat(100));
  console.log(
    pad("FECHAMENTO calc", 25) +
      pad("—", 24) +
      pad("—", 14) +
      pad(money(running), 14) +
      pad(money(p[BUCKET]), 14) +
      `(${BUCKET} atual)`
  );

  const drift = n(p[BUCKET]) - running;
  if (Math.abs(drift) > 1) {
    console.log(
      `\n⚠ Divergência: saldo calc ${money(running)} vs ${BUCKET} atual ${money(p[BUCKET])} → diff ${money(drift)}`
    );
    console.log(
      "  (pode ser movimento fora do ledger, bucket diferente, ou tx sem amount no período)"
    );
  } else {
    console.log(`\n✓ Cronologia fecha com ${BUCKET} atual (${money(p[BUCKET])})`);
  }

  console.log("\n==> Resumo por dia");
  for (const [d, ag] of byDay) {
    console.log(
      `  ${d}  entradas ${money(ag.in)}  saídas ${money(ag.out)}  net ${money(ag.net)}  (${ag.n} lanç.)`
    );
  }
  const totIn = txs.filter((t) => n(t.amount_cents) > 0).reduce((a, t) => a + n(t.amount_cents), 0);
  const totOut = txs.filter((t) => n(t.amount_cents) < 0).reduce((a, t) => a + n(t.amount_cents), 0);
  console.log(
    `\n  TOTAL período: entradas ${money(totIn)} | saídas ${money(totOut)} | net ${money(totIn + totOut)} | lançamentos ${txs.length}`
  );
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
