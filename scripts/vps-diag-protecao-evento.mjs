#!/usr/bin/env node
/**
 * Diagnóstico — bilhete Senilvo / proteção 003d5bc9
 * Mostra status, settled_outcome, placar do jogo e o que o contrato v10 entende.
 *
 * Na VPS:
 *   PROT=003d5bc9 NAME="Senilvo" node scripts/vps-diag-protecao-evento.mjs
 *   # ou ID completo:
 *   PROT_ID=uuid node scripts/vps-diag-protecao-evento.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROT = String(process.env.PROT || process.env.PROT_PREFIX || "003d5bc9")
  .trim()
  .toLowerCase();
const PROT_ID = String(process.env.PROT_ID || "").trim();
const NAME = String(process.env.NAME || "Senilvo").trim();

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

const contract = await import(
  pathToFileURL(path.resolve(__dirname, "lib/protection-flow-contract.mjs")).href
);
const {
  settlementOutcomeFromProtectionRow,
  settlementDeductionCents,
  isFeeUpfrontProtection,
  isStakeLockProtection,
  settlementCreditParts,
} = contract;

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
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 500)}`);
  return data;
}

async function findProtection() {
  const tables = ["protections", "back_protections"];
  if (PROT_ID) {
    for (const t of tables) {
      const rows = await sb(
        `/rest/v1/${t}?id=eq.${encodeURIComponent(PROT_ID)}&select=*&limit=1`
      );
      if (Array.isArray(rows) && rows[0]) return { ...rows[0], _table: t };
    }
  }
  for (const t of tables) {
    const rows = await sb(
      `/rest/v1/${t}?select=*&order=created_at.desc&limit=500`
    );
    const list = Array.isArray(rows) ? rows : [];
    const hit = list.find((r) => String(r.id || "").toLowerCase().startsWith(PROT));
    if (hit) return { ...hit, _table: t };
  }
  // fallback por nome
  if (NAME) {
    const q = encodeURIComponent("%" + NAME + "%");
    const profs = await sb(
      `/rest/v1/profiles?select=id,full_name&full_name=ilike.${q}&limit=10`
    );
    const plist = Array.isArray(profs) ? profs : [];
    for (const u of plist) {
      for (const t of tables) {
        const rows = await sb(
          `/rest/v1/${t}?user_id=eq.${encodeURIComponent(
            u.id
          )}&select=*&order=created_at.desc&limit=50`
        );
        const list = Array.isArray(rows) ? rows : [];
        const hit =
          list.find((r) => String(r.id || "").toLowerCase().startsWith(PROT)) ||
          list[0];
        if (hit && String(hit.id || "").toLowerCase().startsWith(PROT)) {
          return { ...hit, _table: t, _user_name: u.full_name };
        }
      }
    }
  }
  return null;
}

async function main() {
  console.log("==> Diagnóstico proteção / evento");
  console.log("    PROT:", PROT_ID || PROT);
  console.log("    NAME:", NAME || "-");

  const row = await findProtection();
  if (!row) {
    console.error("Proteção não encontrada");
    process.exit(1);
  }

  const meta = metaOf(row);
  const amount = n(row.responsibility_cents || row.amount_cents);
  const fee = settlementDeductionCents(row);
  const mapped = settlementOutcomeFromProtectionRow(row);
  const feeUp = isFeeUpfrontProtection(row);
  const stakeLock = isStakeLockProtection(row);

  const prof = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      row.user_id
    )}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents&limit=1`
  );
  const p = Array.isArray(prof) ? prof[0] : null;

  console.log("\n---- proteção ----");
  console.log("  id:             ", row.id);
  console.log("  table:          ", row._table);
  console.log("  user:           ", p?.full_name || row._user_name || row.user_id);
  console.log("  status:         ", row.status);
  console.log("  settled_outcome:", row.settled_outcome || "(null)");
  console.log("  settled_at:     ", row.settled_at || "-");
  console.log("  created_at:     ", row.created_at || "-");
  console.log("  amount:         ", money(amount));
  console.log("  odd:            ", row.odd);
  console.log("  billing:        ", meta.billing_model || "-");
  console.log("  fee_upfront:    ", feeUp);
  console.log("  stake_lock:     ", stakeLock);
  console.log("  fee (contrato): ", money(fee));
  console.log("  market_type:    ", meta.market_type || meta.side || "-");
  console.log("  market_odd:     ", meta.market_odd || meta.calculations?.marketOdd || "-");
  console.log("  → mapped v10:   ", mapped || "(vazio)");
  if (mapped) {
    const parts = settlementCreditParts(row, mapped);
    console.log(
      "  → credit parts: ",
      `stake=${parts.stake} fee=${parts.fee} total=${parts.total}`
    );
  }

  console.log("\n---- carteira ----");
  if (p) {
    console.log("  Apostador:      ", money(p.balance_cents));
    console.log("  reusable:       ", money(p.reusable_balance_cents));
    console.log("  locked:         ", money(p.locked_balance_cents));
    console.log("  Reembolso:      ", money(p.deduction_balance_cents));
  }

  // match
  let match = null;
  if (row.match_id) {
    const ms = await sb(
      `/rest/v1/matches?id=eq.${encodeURIComponent(
        row.match_id
      )}&select=*&limit=1`
    );
    match = Array.isArray(ms) ? ms[0] : null;
  }

  console.log("\n---- evento / partida ----");
  if (!match) {
    console.log("  (match não encontrado)", row.match_id);
  } else {
    const mm = metaOf(match);
    console.log("  match_id:       ", match.id);
    console.log("  home:           ", match.home_team || match.home || "-");
    console.log("  away:           ", match.away_team || match.away || "-");
    console.log("  status:         ", match.status);
    console.log("  final_score:    ", match.final_score || match.score || "-");
    console.log("  settled_at:     ", match.settled_at || "-");
    console.log("  is_published:   ", match.is_published);
    console.log(
      "  settled_by:     ",
      mm.settled_by_name || mm.settled_by || match.settled_by || "-"
    );
    console.log(
      "  settle_outcome: ",
      mm.settled_outcome ||
        mm.outcome ||
        match.settled_outcome ||
        "-"
    );
    const markets = Array.isArray(match.markets) ? match.markets : [];
    if (markets.length) {
      console.log("  markets:");
      for (const mkt of markets.slice(0, 12)) {
        console.log(
          "   -",
          mkt.id || mkt.market_id || mkt.type || "?",
          "settled_outcome=",
          mkt.settled_outcome || mkt.outcome || "-",
          "odd=",
          mkt.odd || mkt.odds || "-"
        );
      }
    }
  }

  // audit logs
  try {
    const audits = await sb(
      `/rest/v1/admin_audit_logs?select=id,action,created_at,metadata,details&order=created_at.desc&limit=30`
    );
    const list = Array.isArray(audits) ? audits : [];
    const related = list.filter((a) => {
      const blob = JSON.stringify(a).toLowerCase();
      return (
        blob.includes(String(row.id).toLowerCase()) ||
        (row.match_id && blob.includes(String(row.match_id).toLowerCase()))
      );
    });
    console.log("\n---- admin_audit (relacionados) ----");
    if (!related.length) console.log("  (nenhum)");
    for (const a of related.slice(0, 10)) {
      console.log(
        " ",
        a.created_at,
        a.action,
        JSON.stringify(a.metadata || a.details || {}).slice(0, 180)
      );
    }
  } catch (e) {
    console.log("\n---- admin_audit ----");
    console.log("  (indisponível)", e instanceof Error ? e.message : e);
  }

  // wallet txs
  const txs = await sb(
    `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
      row.id
    )}&select=id,type,amount_cents,created_at,metadata&order=created_at.asc&limit=50`
  );
  const tlist = Array.isArray(txs) ? txs : [];
  console.log("\n---- wallet_transactions (ref=proteção) ----");
  if (!tlist.length) console.log("  (nenhuma)");
  for (const t of tlist) {
    const tm = metaOf(t);
    console.log(
      " ",
      t.created_at,
      t.type,
      money(t.amount_cents),
      "outcome=" + (tm.outcome || "-"),
      "stake_returned=" + (tm.stake_returned ?? "-"),
      "unlocked=" + (tm.unlocked_locked ?? "-"),
      "tag=" + (tm.tag || "-")
    );
  }

  console.log("\n---- interpretação ----");
  console.log(
    "  O reparo do dia usou mapped =",
    mapped || "(vazio)",
    "a partir de status/settled_outcome da proteção."
  );
  if (mapped === "void") {
    console.log(
      "  Se o jogo NÃO foi Empate Anula, o status/settled_outcome da proteção está ERRADO"
    );
    console.log(
      "  e o heal void pode ter sido indevido. Informe o outcome real (exchange|arbishield)."
    );
  }
  const matchOutcome =
    (match &&
      (metaOf(match).settled_outcome ||
        metaOf(match).outcome ||
        match.settled_outcome)) ||
    "";
  if (matchOutcome) {
    console.log("  Outcome gravado no match:", matchOutcome);
    if (String(matchOutcome).toLowerCase() !== String(mapped).toLowerCase()) {
      console.log(
        "  ⚠ DIVERGÊNCIA proteção.mapped ≠ match.outcome — precisa realinhar."
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
