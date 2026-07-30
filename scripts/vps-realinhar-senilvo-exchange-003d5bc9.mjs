#!/usr/bin/env node
/**
 * Realinha Senilvo 003d5bc9 → EXCHANGE conforme v10 / stake_lock_v1
 *
 * Regra v10 (fonte de verdade):
 *   Exchange → DEVOLVE stake · cobra SÓ dedução · Reembolso R$ 0
 *
 * NÃO debita os R$200 (stake deve voltar).
 * Cobra a dedução ArbiShield da odd canônica se ainda não cobrada.
 * Corrige status cancelled → won_exchange e fecha o match.
 *
 * Dry-run:
 *   node scripts/vps-realinhar-senilvo-exchange-003d5bc9.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-realinhar-senilvo-exchange-003d5bc9.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const PROT_PREFIX = String(process.env.PROT || "003d5bc9").trim().toLowerCase();
const TAG = "realign-senilvo-exchange-v10-003d5bc9";

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
const { settlementDeductionCents, computeArbiShieldDeductionCents } = contract;

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

async function sb(p, { method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body != null ? JSON.stringify(body) : undefined,
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

async function insertTx(payload) {
  try {
    return await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: { ...payload, note: payload.metadata?.note || null },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/PGRST204|note/i.test(msg)) {
      return sb(`/rest/v1/wallet_transactions`, {
        method: "POST",
        body: payload,
      });
    }
    throw err;
  }
}

async function main() {
  console.log("==> Realinhar Senilvo → EXCHANGE (regra v10)");
  console.log("    Exchange = devolve stake · cobra só dedução · Reembolso R$0");
  console.log("    NÃO debita os R$200 do stake");
  console.log("    FIX:", FIX ? "SIM" : "não (dry-run)");

  let row = null;
  let table = "protections";
  for (const t of ["protections", "back_protections"]) {
    const rows = await sb(
      `/rest/v1/${t}?select=*&order=created_at.desc&limit=800`
    );
    const hit = (Array.isArray(rows) ? rows : []).find((r) =>
      String(r.id || "").toLowerCase().startsWith(PROT_PREFIX)
    );
    if (hit) {
      row = hit;
      table = t;
      break;
    }
  }
  if (!row) throw new Error("proteção não encontrada");

  // Força cálculo v10 (ignora billing fee_upfront legado para a taxa do settle)
  const rowForFee = {
    ...row,
    metadata: {
      ...metaOf(row),
      billing_model: "stake_lock_v1",
      stake_lock: true,
      fee_upfront: false,
      market_type: metaOf(row).market_type || "LAY",
      market_odd: metaOf(row).market_odd || row.odd,
    },
  };
  const feeExpected =
    (typeof computeArbiShieldDeductionCents === "function"
      ? computeArbiShieldDeductionCents(rowForFee)
      : 0) || settlementDeductionCents(rowForFee);

  const prof = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      row.user_id
    )}&select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,deduction_balance_cents&limit=1`
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) throw new Error("perfil não encontrado");

  const match = row.match_id
    ? (
        await sb(
          `/rest/v1/matches?id=eq.${encodeURIComponent(
            row.match_id
          )}&select=*&limit=1`
        )
      )?.[0]
    : null;

  const txs = await sb(
    `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
      row.id
    )}&select=id,type,amount_cents,created_at,metadata&order=created_at.asc&limit=80`
  );
  const tlist = Array.isArray(txs) ? txs : [];

  const already = tlist.some(
    (t) => metaOf(t).tag === TAG || metaOf(t).tag === "realign-senilvo-exchange-003d5bc9-v1"
  );

  // Taxa líquida já retida na plataforma (fees cobrados − refunds)
  let feeNet = 0;
  for (const t of tlist) {
    const typ = String(t.type || "");
    const amt = n(t.amount_cents);
    const m = metaOf(t);
    if (typ === "protection_fee" && amt < 0) feeNet += Math.abs(amt);
    if (typ === "protection_refund" && amt > 0) feeNet -= amt;
    if (
      typ === "protection_settlement" &&
      amt < 0 &&
      (m.outcome === "exchange" || m.clawback_kind === "fee")
    ) {
      feeNet += Math.abs(amt);
    }
  }
  // Stake já devolvido?
  const stakeReturned = tlist.some((t) => {
    const m = metaOf(t);
    return (
      typPositiveStake(t, m) ||
      (t.type === "protection_settlement" &&
        n(t.amount_cents) > 0 &&
        m.stake_returned === true)
    );
  });
  // Clawback indevido de stake (script antigo) → precisa recreditar
  const badStakeClawback = tlist
    .filter((t) => {
      const m = metaOf(t);
      return (
        n(t.amount_cents) < 0 &&
        (m.tag === "clawback-senilvo-cancel-003d5bc9-v1" ||
          (m.tag === "realign-senilvo-exchange-003d5bc9-v1" &&
            m.clawback_kind === "stake"))
      );
    })
    .reduce((s, t) => s + Math.abs(n(t.amount_cents)), 0);

  const feeStillDue = Math.max(0, feeExpected - Math.max(0, feeNet));
  const stakeToRestore = badStakeClawback; // se debitou 200 errado, devolve

  const amount = n(row.responsibility_cents || row.amount_cents);
  const bal = n(p.balance_cents) + n(p.reusable_balance_cents);

  console.log("\n---- estado ----");
  console.log("  proteção:", row.id, `(${table})`);
  console.log("  status:  ", row.status, "→ won_exchange");
  console.log("  cliente: ", p.full_name);
  console.log("  Apostador:", money(bal));
  console.log(
    "  match:   ",
    match
      ? `${match.home_team || "?"} × ${match.away_team || "?"} · ${match.status}`
      : "-"
  );
  console.log("  stake:   ", money(amount), stakeReturned ? "(já devolvido ✓)" : "(falta devolver)");
  console.log("  dedução v10 esperada:", money(feeExpected));
  console.log("  taxa líquida atual:  ", money(feeNet));
  console.log("  dedução ainda devida:", money(feeStillDue));
  console.log("  restaurar stake (clawback errado):", money(stakeToRestore));
  console.log(
    "  Apostador após:        ",
    money(bal + stakeToRestore - feeStillDue)
  );

  if (
    already &&
    feeStillDue === 0 &&
    stakeToRestore === 0 &&
    String(row.status).toLowerCase() === "won_exchange"
  ) {
    console.log("\nOK — já conforme v10 Exchange.");
    return;
  }

  if (!FIX) {
    console.log("\n(dry-run) FIX=1 vai:");
    if (stakeToRestore > 0) {
      console.log("  · RECREDITAR", money(stakeToRestore), "(desfaz clawback indevido do stake)");
    }
    if (!stakeReturned && stakeToRestore === 0 && amount > 0) {
      console.log("  · garantir stake devolvido", money(amount), "(já deve estar)");
    }
    console.log("  · cobrar dedução", money(feeStillDue), "(se > 0)");
    console.log("  · status → won_exchange · match settled exchange");
    console.log("  · NÃO debitar os R$200 do stake");
    return;
  }

  const now = new Date().toISOString();
  let newBal = bal;

  // 1) Restaura stake se houve clawback indevido
  if (stakeToRestore > 0) {
    newBal += stakeToRestore;
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
      method: "PATCH",
      body: {
        balance_cents: newBal,
        reusable_balance_cents: 0,
        updated_at: now,
      },
    });
    await insertTx({
      user_id: row.user_id,
      type: "protection_settlement",
      amount_cents: stakeToRestore,
      ref: row.id,
      metadata: {
        tag: TAG,
        note: `${TAG}: restaura stake — v10 Exchange DEVOLVE stake`,
        outcome: "exchange",
        stake_returned: true,
        unlock_return_to_origin: true,
        billing_model: "stake_lock_v1",
        protection_id: row.id,
      },
      created_at: now,
    });
    console.log("  OK restaurou stake", money(stakeToRestore));
  }

  // 2) Cobra dedução faltante
  if (feeStillDue > 0) {
    if (newBal < feeStillDue) {
      throw new Error(
        `Saldo insuficiente para dedução: ${money(newBal)} < ${money(feeStillDue)}`
      );
    }
    newBal -= feeStillDue;
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
      method: "PATCH",
      body: {
        balance_cents: newBal,
        reusable_balance_cents: 0,
        locked_balance_cents: 0,
        updated_at: now,
      },
    });
    await insertTx({
      user_id: row.user_id,
      type: "protection_settlement",
      amount_cents: -feeStillDue,
      ref: row.id,
      metadata: {
        tag: TAG,
        note: `${TAG}: cobra dedução Exchange v10 (lucro−4,5%−1,5%)`,
        outcome: "exchange",
        exchange_no_credit: true,
        fee_charged_cents: feeStillDue,
        fee_expected_cents: feeExpected,
        stake_returned: true,
        unlocked_locked: true,
        billing_model: "stake_lock_v1",
        protection_id: row.id,
        match_id: row.match_id || null,
      },
      created_at: new Date().toISOString(),
    });
    console.log("  OK cobrou dedução", money(feeStillDue));
  }

  // 3) Status proteção
  const meta = metaOf(row);
  await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    body: {
      status: "won_exchange",
      settled_outcome: "exchange",
      settled_at: row.settled_at || now,
      platform_deduction_cents: feeExpected,
      metadata: {
        ...meta,
        billing_model: "stake_lock_v1",
        stake_lock: true,
        realigned_to_exchange: true,
        realign_tag: TAG,
        previous_status: row.status,
        previous_settled_outcome: row.settled_outcome || null,
        fee_expected_cents: feeExpected,
      },
      updated_at: now,
    },
  });
  console.log("  OK proteção → won_exchange");

  // 4) Match
  if (match) {
    const mm = metaOf(match);
    const markets = Array.isArray(match.markets)
      ? match.markets.map((m) => ({
          ...m,
          settled_outcome: "exchange",
        }))
      : match.markets;
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(match.id)}`, {
      method: "PATCH",
      body: {
        status: "settled",
        is_published: false,
        settled_at: match.settled_at || now,
        markets,
        metadata: {
          ...mm,
          settled_outcome: "exchange",
          outcome: "exchange",
          realign_tag: TAG,
          previous_status: match.status,
        },
        updated_at: now,
      },
    });
    console.log("  OK match → settled / exchange");
  }

  await insertTx({
    user_id: row.user_id,
    type: "protection_settlement",
    amount_cents: 0,
    ref: row.id,
    metadata: {
      tag: TAG,
      note: `${TAG}: realinhado → Exchange v10 (stake devolvido · dedução cobrada · Reembolso R$0)`,
      outcome: "exchange",
      exchange_no_credit: true,
      stake_returned: true,
      unlocked_locked: true,
      fee_expected_cents: feeExpected,
      billing_model: "stake_lock_v1",
      protection_id: row.id,
      match_id: row.match_id || null,
    },
    created_at: new Date().toISOString(),
  });

  const after = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      row.user_id
    )}&select=balance_cents,reusable_balance_cents&limit=1`
  );
  const a = Array.isArray(after) ? after[0] : null;
  console.log("\nConcluído (regra v10 Exchange).");
  console.log(
    "  Apostador:",
    money(n(a?.balance_cents) + n(a?.reusable_balance_cents))
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
