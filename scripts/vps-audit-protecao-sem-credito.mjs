#!/usr/bin/env node
/**
 * Auditoria / correção — proteção encerrada sem crédito (caso João Paulo / Klubi×Haka).
 *
 *   NAME="JOÃO PAULO" MATCH="Klubi" node scripts/vps-audit-protecao-sem-credito.mjs
 *   FIX=1 NAME="JOÃO PAULO" MATCH="Klubi" node scripts/vps-audit-protecao-sem-credito.mjs
 *
 * FIX credita settlement faltante (outcome=exchange → stake−taxa; arbishield → stake em reusable)
 * ou estorno total se FORCE_REFUND=1.
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const FORCE_REFUND =
  process.env.FORCE_REFUND === "1" || process.env.FORCE_REFUND === "true";
const NAME = String(process.env.NAME || "JOÃO PAULO LEITE").trim();
const MATCH = String(process.env.MATCH || "Klubi").trim();
const OUTCOME = String(process.env.OUTCOME || "exchange").trim().toLowerCase(); // exchange | arbishield

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

function feeOf(row) {
  const raw =
    row.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row.locked_deduction_cents;
  return Math.max(0, n(raw));
}

function creditFor(row, outcome) {
  const amount = n(row.responsibility_cents || row.amount_cents);
  if (FORCE_REFUND) return amount;
  if (String(outcome).toLowerCase() === "arbishield") return amount;
  const fee = Math.min(feeOf(row), amount);
  return Math.max(0, amount - fee);
}

async function main() {
  console.log("==> Auditoria proteção encerrada sem crédito");
  console.log("    NAME:", NAME);
  console.log("    MATCH~", MATCH);
  console.log("    OUTCOME:", OUTCOME, FORCE_REFUND ? "(FORCE_REFUND=estorno total)" : "");
  console.log("    FIX:", FIX ? "SIM" : "não");

  const q = encodeURIComponent("%" + NAME + "%");
  const profs = await sb(
    `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents,locked_balance_cents&full_name=ilike.${q}&order=created_at.desc&limit=20`
  );
  const plist = Array.isArray(profs) ? profs : [];
  if (!plist.length) throw new Error("cliente não encontrado");
  if (plist.length > 1) {
    console.log("Matches nome:");
    plist.forEach((p) =>
      console.log(`  ${p.id}  ${p.full_name}  ${money(p.balance_cents)}`)
    );
  }
  const user = plist[0];
  console.log("\n  user:", user.id);
  console.log("  nome:", user.full_name);
  console.log(
    "  saldo:",
    money(user.balance_cents),
    "reusable",
    money(user.reusable_balance_cents),
    "locked",
    money(user.locked_balance_cents)
  );

  const mq = encodeURIComponent("%" + MATCH + "%");
  const matches = await sb(
    `/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status&or=(home_team.ilike.${mq},away_team.ilike.${mq})&order=starts_at.desc&limit=30`
  );
  const mlist = Array.isArray(matches) ? matches : [];
  console.log(`\n==> Partidas ~${MATCH}: ${mlist.length}`);
  mlist.forEach((m) =>
    console.log(
      `  ${m.id.slice(0, 8)}  ${m.home_team} × ${m.away_team}  ${m.starts_at}  ${m.status || "—"}`
    )
  );

  const matchIds = mlist.map((m) => m.id);
  const matchMap = Object.fromEntries(mlist.map((m) => [m.id, m]));

  // Proteções do usuário (LAY + BACK)
  const lays = await sb(
    `/rest/v1/protections?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=200`
  );
  const backs = await sb(
    `/rest/v1/back_protections?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=200`
  );

  let rows = []
    .concat(
      (Array.isArray(lays) ? lays : []).map((r) => ({
        ...r,
        _table: "protections",
        market_category: "LAY",
      }))
    )
    .concat(
      (Array.isArray(backs) ? backs : []).map((r) => ({
        ...r,
        _table: "back_protections",
        market_category: "BACK",
      }))
    );

  if (matchIds.length) {
    const filtered = rows.filter((r) => matchIds.includes(r.match_id));
    if (filtered.length) rows = filtered;
  }

  // Prefer Haka if present
  const haka = rows.filter((r) => {
    const m = matchMap[r.match_id];
    return m && /haka/i.test(`${m.home_team} ${m.away_team}`);
  });
  if (haka.length) rows = haka;

  console.log(`\n==> Proteções alvo: ${rows.length}`);
  if (!rows.length) throw new Error("nenhuma proteção encontrada para o filtro");

  for (const row of rows) {
    const m = matchMap[row.match_id] || {};
    const amount = n(row.responsibility_cents || row.amount_cents);
    const credit = creditFor(row, row.settled_outcome || OUTCOME);
    console.log("\n— proteção", row.id);
    console.log(
      `  jogo: ${(m.home_team || "?") + " × " + (m.away_team || "?")}  ${m.starts_at || ""}`
    );
    console.log(
      `  tabela=${row._table}  side=${row.market_category}  status=${row.status}  outcome=${row.settled_outcome || row.result || "—"}`
    );
    console.log(
      `  stake=${money(amount)}  fee=${money(feeOf(row))}  crédito esperado=${money(credit)}`
    );
    console.log(`  odd=${row.odd}  settled_at=${row.settled_at || "—"}`);

    const txs = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&or=(ref.eq.${encodeURIComponent(row.id)},metadata->>protection_id.eq.${encodeURIComponent(row.id)})&order=created_at.asc&limit=50`
    ).catch(async () => {
      // fallback sem filter jsonb
      const all = await sb(
        `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=300`
      );
      return (Array.isArray(all) ? all : []).filter(
        (t) =>
          String(t.ref || "") === String(row.id) ||
          (t.metadata && String(t.metadata.protection_id || "") === String(row.id))
      );
    });
    const tlist = Array.isArray(txs) ? txs : [];
    console.log("  wallet_tx:");
    if (!tlist.length) console.log("    (nenhuma)");
    for (const t of tlist) {
      console.log(
        `    ${t.created_at}  ${t.type}  ${money(t.amount_cents)}  ${JSON.stringify(t.metadata || {}).slice(0, 80)}`
      );
    }

    const credited = tlist.some((t) =>
      ["protection_settlement", "protection_release", "protection_refund"].includes(
        String(t.type || "")
      )
    );
    const st = String(row.status || "").toLowerCase();
    const closed = [
      "settled",
      "won_exchange",
      "lost_exchange",
      "won_platform",
      "lost_platform",
      "cancelled",
      "refund_requested",
      "pending_refund",
    ].includes(st);

    if (!closed) {
      console.log("  → ainda ativa — cliente pode contestar/cancelar no app");
      continue;
    }
    if (credited) {
      console.log("  → OK já tem crédito no ledger");
      continue;
    }

    console.log("  ⚠ ENCERRADA SEM CRÉDITO NO LEDGER");
    console.log(
      "  (Contestar só funciona em status active — por isso não apareceu opção)"
    );

    if (!FIX) {
      console.log(
        `  Para creditar ${money(credit)}: FIX=1 OUTCOME=${OUTCOME} NAME=... MATCH=Klubi node ...`
      );
      console.log(
        "  Estorno integral (sem taxa): FIX=1 FORCE_REFUND=1 ..."
      );
      continue;
    }

    // Aplicar crédito
    const outcome = FORCE_REFUND
      ? "exchange"
      : String(row.settled_outcome || OUTCOME).toLowerCase();
    const wonArbi = !FORCE_REFUND && outcome === "arbishield";
    const pay = creditFor(row, outcome);
    const now = new Date().toISOString();

    const prof = await sb(
      `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(user.id)}&limit=1`
    );
    const p = Array.isArray(prof) ? prof[0] : null;
    if (!p) throw new Error("profile sumiu");

    const patch = {
      locked_balance_cents: Math.max(0, n(p.locked_balance_cents) - amount),
      updated_at: now,
    };
    if (FORCE_REFUND || !wonArbi) {
      patch.balance_cents = n(p.balance_cents) + pay;
    } else {
      patch.reusable_balance_cents = n(p.reusable_balance_cents) + pay;
    }

    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: patch,
      });
    } catch {
      delete patch.updated_at;
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: patch,
      });
    }

    const txType = FORCE_REFUND ? "protection_refund" : "protection_settlement";
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: user.id,
        type: txType,
        amount_cents: pay,
        ref: row.id,
        metadata: {
          protection_id: row.id,
          match_id: row.match_id,
          outcome: FORCE_REFUND ? "manual_refund" : outcome,
          stake_cents: amount,
          fee_cents: FORCE_REFUND ? 0 : wonArbi ? 0 : feeOf(row),
          reason: "clawback_encerrada_sem_credito",
          client: user.full_name,
          fix: "vps-audit-protecao-sem-credito-v1",
        },
      },
    });

    // Normaliza status se era "settled" genérico
    if (st === "settled" || FORCE_REFUND) {
      const newStatus = FORCE_REFUND
        ? "cancelled"
        : wonArbi
          ? "lost_exchange"
          : "won_exchange";
      try {
        await sb(
          `/rest/v1/${row._table}?id=eq.${encodeURIComponent(row.id)}`,
          {
            method: "PATCH",
            body: {
              status: newStatus,
              settled_at: row.settled_at || now,
              settled_outcome: FORCE_REFUND ? "manual_refund" : outcome,
              result: FORCE_REFUND ? "cancelled_refund" : newStatus,
            },
          }
        );
      } catch (e) {
        console.warn("  status patch:", e.message || e);
      }
    }

    console.log(
      `  OK creditado ${money(pay)} via ${txType} → saldo agora ${money(patch.balance_cents ?? p.balance_cents)}`
    );
  }

  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
