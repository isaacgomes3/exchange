#!/usr/bin/env node
/**
 * Auditoria das proteções de um cliente (VPS, SERVICE_ROLE).
 *
 *   NAME="DIEGO HENRIQUE" node scripts/vps-audit-user-protecoes.mjs
 *   USER_ID=uuid node scripts/vps-audit-user-protecoes.mjs
 */
import fs from "node:fs";
import path from "node:path";

const NAME = String(process.env.NAME || "").trim();
const USER_ID = String(process.env.USER_ID || process.env.ID || "").trim();

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
if (!NAME && !USER_ID) {
  console.error('Informe NAME="DIEGO HENRIQUE" ou USER_ID=...');
  process.exit(1);
}

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 240)}`);
  return data;
}

function metaOf(row) {
  let m = row?.metadata;
  if (!m) return {};
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch {
      return {};
    }
  }
  return typeof m === "object" && m ? m : {};
}

async function main() {
  let profile;
  if (USER_ID) {
    const rows = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID)}&select=id,full_name,balance_cents,deduction_balance_cents,demo_balance_cents,created_at&limit=1`
    );
    profile = Array.isArray(rows) ? rows[0] : null;
  } else {
    const rows = await sb(
      `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=id,full_name,balance_cents,deduction_balance_cents,demo_balance_cents,created_at&limit=10`
    );
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      console.error("Nenhum perfil para NAME=", NAME);
      process.exit(1);
    }
    if (list.length > 1) {
      console.log("Vários perfis — use USER_ID=");
      for (const p of list) {
        console.log("-", p.id, p.full_name, money(p.balance_cents));
      }
      process.exit(2);
    }
    profile = list[0];
  }
  if (!profile) {
    console.error("Perfil não encontrado");
    process.exit(1);
  }

  const uid = profile.id;
  console.log("=== Perfil ===");
  console.log(profile.full_name, uid);
  console.log(
    "saldo",
    money(profile.balance_cents),
    "| reembolso",
    money(profile.deduction_balance_cents),
    "| demo",
    money(profile.demo_balance_cents)
  );

  const cols =
    "id,user_id,status,amount_cents,responsibility_cents,odd,match_id,created_at,settled_at,settled_outcome,platform_deduction_cents,locked_deduction_cents,metadata";
  const [lays, backs] = await Promise.all([
    sb(
      `/rest/v1/protections?user_id=eq.${encodeURIComponent(uid)}&select=${cols}&order=created_at.desc&limit=200`
    ),
    sb(
      `/rest/v1/back_protections?user_id=eq.${encodeURIComponent(uid)}&select=${cols}&order=created_at.desc&limit=200`
    ),
  ]);
  const rows = [
    ...(Array.isArray(lays) ? lays.map((r) => ({ ...r, side: "LAY" })) : []),
    ...(Array.isArray(backs) ? backs.map((r) => ({ ...r, side: "BACK" })) : []),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))];
  const matchMap = new Map();
  if (matchIds.length) {
    const ms = await sb(
      `/rest/v1/matches?id=in.(${matchIds.map(encodeURIComponent).join(",")})&select=id,home_team,away_team,league,starts_at`
    );
    for (const m of Array.isArray(ms) ? ms : []) matchMap.set(m.id, m);
  }

  console.log("\n=== Proteções na conta (", rows.length, ") ===");
  let withFeeTx = 0;
  for (const r of rows) {
    const meta = metaOf(r);
    const m = matchMap.get(r.match_id) || {};
    const home = meta.home_team || m.home_team || "?";
    const away = meta.away_team || m.away_team || "?";
    const market = meta.market_name || meta.marketName || "—";
    const amount = r.responsibility_cents || r.amount_cents || 0;
    let feeTx = [];
    try {
      feeTx = await sb(
        `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(uid)}&ref=eq.${encodeURIComponent(r.id)}&select=id,type,amount_cents,created_at&order=created_at.asc&limit=10`
      );
    } catch {
      feeTx = [];
    }
    if (Array.isArray(feeTx) && feeTx.length) withFeeTx += 1;
    console.log("----");
    console.log(r.side, r.status, r.settled_outcome || "-", money(amount));
    console.log(home, "x", away, "|", market);
    console.log(
      "id",
      r.id,
      "| match",
      r.match_id || "-",
      "| criada",
      r.created_at,
      "| settled",
      r.settled_at || "-"
    );
    console.log(
      "source",
      meta.source || "-",
      "| billing",
      meta.billing_model || "-",
      "| fee",
      money(r.platform_deduction_cents || meta.fee_charged_cents || 0)
    );
    console.log(
      "wallet_txs",
      Array.isArray(feeTx) && feeTx.length
        ? feeTx
            .map((t) => `${t.type}:${money(t.amount_cents)}@${t.created_at}`)
            .join(" ; ")
        : "(nenhuma)"
    );
  }
  console.log("\n=== Resumo ===");
  console.log("total", rows.length, "| com wallet_tx", withFeeTx);
  console.log(
    "sem wallet_tx",
    rows.length - withFeeTx,
    "(pode ser legado ou proteção fantasma)"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
