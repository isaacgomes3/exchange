#!/usr/bin/env node
/**
 * Diagnóstico: internal_transfer — de/para qual carteira.
 *
 * TX_ID=9fcb1d29-ddf1-44cd-bf7d-f8c0a25b33a6 node scripts/vps-diag-internal-transfer.mjs
 * ou: AMOUNT_CENTS=25551 NAME='Pedro' node scripts/vps-diag-internal-transfer.mjs
 */
import fs from "node:fs";
import path from "node:path";

const TX_ID = String(process.env.TX_ID || "9fcb1d29-ddf1-44cd-bf7d-f8c0a25b33a6").trim();
const AMOUNT_CENTS = Number(process.env.AMOUNT_CENTS || 25551);
const NAME = String(process.env.NAME || "Pedro Iuri").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf").trim().toLowerCase();

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
  console.error("ERRO: SERVICE_ROLE_KEY ausente — rode na VPS");
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

const BUCKET_LABEL = {
  deduction_balance_cents: "Saldo Reembolso",
  balance_cents: "Saldo Real (Apostador)",
  reusable_balance_cents: "Saldo Reutilizável",
  desafio_balance_cents: "Carteira Desafio",
  demo_balance_cents: "Demo",
  locked_balance_cents: "Locked",
};

function labelBucket(k) {
  return BUCKET_LABEL[k] || k || "?";
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
  console.log("==> Diagnóstico internal_transfer");
  console.log("    TX_ID:", TX_ID);
  console.log("    valor esperado:", money(AMOUNT_CENTS));

  let tx = null;
  if (TX_ID) {
    const rows = await sb(
      `/rest/v1/wallet_transactions?select=*&id=eq.${encodeURIComponent(TX_ID)}&limit=1`
    );
    tx = Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  if (!tx) {
    console.log("    (id não achou — buscando por nome/valor)");
    const profiles = await sb(
      `/rest/v1/profiles?select=id,full_name&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    const p = Array.isArray(profiles) && profiles[0];
    if (!p) {
      const byName = await sb(
        `/rest/v1/profiles?select=id,full_name&full_name=ilike.*${encodeURIComponent(NAME.split(" ")[0])}*&limit=10`
      );
      console.log("perfis:", byName);
      process.exit(2);
    }
    const txs = await sb(
      `/rest/v1/wallet_transactions?select=*&user_id=eq.${encodeURIComponent(p.id)}&type=eq.internal_transfer&order=created_at.desc&limit=50`
    );
    tx = (Array.isArray(txs) ? txs : []).find((t) => n(t.amount_cents) === AMOUNT_CENTS) || null;
    if (!tx && Array.isArray(txs) && txs[0]) {
      console.log("\n==> transfers recentes do usuário:");
      for (const t of txs.slice(0, 10)) {
        const m = metaOf(t);
        console.log(
          "   ",
          t.id,
          money(t.amount_cents),
          t.created_at,
          m.from_bucket || m.from,
          "→",
          m.to_bucket || m.to,
          m.kind || m.note || ""
        );
      }
    }
  }

  if (!tx) {
    console.error("transação não encontrada");
    process.exit(2);
  }

  const m = metaOf(tx);
  const from = m.from_bucket || m.from || m.source_bucket || null;
  const to = m.to_bucket || m.to || m.dest_bucket || m.destination_bucket || null;

  let profile = null;
  if (tx.user_id) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,desafio_balance_cents,demo_balance_cents&id=eq.${encodeURIComponent(tx.user_id)}&limit=1`
    );
    profile = Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  console.log("\n==> Transação");
  console.log("    id        :", tx.id);
  console.log("    user_id   :", tx.user_id);
  console.log("    nome      :", profile?.full_name || "?");
  console.log("    type      :", tx.type);
  console.log("    valor     :", money(tx.amount_cents));
  console.log("    criado em :", tx.created_at);
  console.log("    ref       :", tx.ref || "—");

  console.log("\n==> Carteiras (metadata)");
  console.log("    DE  :", labelBucket(from), from ? `(${from})` : "");
  console.log("    PARA:", labelBucket(to), to ? `(${to})` : "");
  if (m.kind) console.log("    kind :", m.kind);
  if (m.note || m.reason) console.log("    note :", m.note || m.reason);
  console.log("    metadata completa:", JSON.stringify(m, null, 2));

  if (profile) {
    console.log("\n==> Saldos atuais do perfil");
    console.log("    Real      :", money(n(profile.balance_cents) + n(profile.reusable_balance_cents)));
    console.log("    Reembolso :", money(profile.deduction_balance_cents));
    console.log("    Desafio   :", money(profile.desafio_balance_cents));
    console.log("    Demo      :", money(profile.demo_balance_cents));
  }

  // Heurística se metadata vazia
  if (!from && !to) {
    console.log("\n==> Sem from/to no metadata — heurística pelo código");
    console.log("    internal_transfer no shim atual = Saldo Reembolso → Carteira Desafio");
    console.log("    (transferDeductionToDesafio)");
  } else {
    console.log("\n==> CONCLUSÃO");
    console.log(
      "    Transferência de",
      labelBucket(from),
      "→",
      labelBucket(to),
      ":",
      money(tx.amount_cents)
    );
  }
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
