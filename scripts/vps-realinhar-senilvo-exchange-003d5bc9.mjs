#!/usr/bin/env node
/**
 * Realinha Senilvo 003d5bc9 → outcome EXCHANGE (bateu casa).
 *
 * Fatos (diagnóstico + dono do produto):
 *   - Jogo Kauno Žalgiris × KÍ Women foi FINALIZADO como Exchange
 *   - Proteção está com status cancelled (ERRADO) + settled_outcome null
 *   - billing fee_upfront_v1: na Exchange NÃO devolve stake; taxa permanece
 *   - Já houve: protection_fee −4,96 · protection_refund +4,96 (indevido se Exchange)
 *               repair void +200 (indevido)
 *
 * Ações FIX=1:
 *   1) Clawback R$200 (stake creditado no heal void)
 *   2) Clawback R$4,96 (estorno de taxa do “cancel”)
 *   3) status → won_exchange · settled_outcome → exchange
 *   4) match → settled/closed · markets settled_outcome=exchange (se ainda open)
 *
 * Dry-run:
 *   node scripts/vps-realinhar-senilvo-exchange-003d5bc9.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-realinhar-senilvo-exchange-003d5bc9.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const PROT_PREFIX = String(process.env.PROT || "003d5bc9").trim().toLowerCase();
const STAKE_CENTS = Math.round(Number(process.env.STAKE_CENTS || 20000));
const FEE_CENTS = Math.round(Number(process.env.FEE_CENTS || 496));
const TAG = "realign-senilvo-exchange-003d5bc9-v1";

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
  console.log("==> Realinhar Senilvo → EXCHANGE");
  console.log("    PROT~", PROT_PREFIX);
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

  const already = tlist.some((t) => metaOf(t).tag === TAG);
  const feeCharged = tlist
    .filter((t) => t.type === "protection_fee" && n(t.amount_cents) < 0)
    .reduce((s, t) => s + Math.abs(n(t.amount_cents)), 0);
  const feeRefunded = tlist
    .filter((t) => t.type === "protection_refund" && n(t.amount_cents) > 0)
    .reduce((s, t) => s + n(t.amount_cents), 0);
  const stakeReturned = tlist
    .filter((t) => {
      const m = metaOf(t);
      return (
        t.type === "protection_settlement" &&
        n(t.amount_cents) > 0 &&
        (m.stake_returned === true || m.tag === "repair-protecoes-dia-v10")
      );
    })
    .reduce((s, t) => s + n(t.amount_cents), 0);
  const clawedStake = tlist
    .filter((t) => {
      const m = metaOf(t);
      return (
        n(t.amount_cents) < 0 &&
        (m.tag === "clawback-senilvo-cancel-003d5bc9-v1" ||
          (m.tag === TAG && m.clawback_kind === "stake"))
      );
    })
    .reduce((s, t) => s + Math.abs(n(t.amount_cents)), 0);
  const clawedFee = tlist
    .filter((t) => {
      const m = metaOf(t);
      return n(t.amount_cents) < 0 && m.tag === TAG && m.clawback_kind === "fee";
    })
    .reduce((s, t) => s + Math.abs(n(t.amount_cents)), 0);

  const stakeToClaw = Math.max(0, Math.min(STAKE_CENTS, stakeReturned - clawedStake));
  // Se refundou taxa no “cancel”, na Exchange a taxa deve permanecer → clawback do refund
  const feeToClaw = Math.max(
    0,
    Math.min(FEE_CENTS, feeRefunded - clawedFee)
  );

  const bal = n(p.balance_cents) + n(p.reusable_balance_cents);

  console.log("\n---- estado atual ----");
  console.log("  proteção:", row.id, `(${table})`);
  console.log("  status:  ", row.status);
  console.log("  settled: ", row.settled_outcome || "(null)");
  console.log("  cliente: ", p.full_name);
  console.log("  Apostador:", money(bal));
  console.log("  locked:  ", money(p.locked_balance_cents));
  console.log(
    "  match:   ",
    match
      ? `${match.home_team || "?"} × ${match.away_team || "?"} · status=${match.status}`
      : row.match_id
  );
  console.log("  fee cobrada:     ", money(feeCharged));
  console.log("  fee estornada:   ", money(feeRefunded), "→ clawback", money(feeToClaw));
  console.log("  stake devolvido: ", money(stakeReturned), "→ clawback", money(stakeToClaw));
  console.log("  realign já feito:", already ? "SIM" : "não");
  console.log(
    "  Apostador após:  ",
    money(bal - stakeToClaw - feeToClaw)
  );

  if (already && stakeToClaw === 0 && feeToClaw === 0) {
    console.log("\nOK — já realinhado.");
    return;
  }

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para:");
    console.log("  · debitar", money(stakeToClaw), "(stake indevido)");
    console.log("  · debitar", money(feeToClaw), "(taxa que deve ficar na plataforma)");
    console.log("  · status → won_exchange · settled_outcome → exchange");
    console.log("  · fechar match como exchange (se open)");
    return;
  }

  const totalDebit = stakeToClaw + feeToClaw;
  if (totalDebit > bal) {
    throw new Error(
      `Saldo insuficiente: Apostador ${money(bal)} < débito ${money(totalDebit)}`
    );
  }

  const now = new Date().toISOString();
  let newBal = bal;

  if (stakeToClaw > 0) {
    newBal -= stakeToClaw;
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
      amount_cents: -stakeToClaw,
      ref: row.id,
      metadata: {
        tag: TAG,
        clawback_kind: "stake",
        note: `${TAG}: clawback stake — Exchange fee_upfront não devolve stake`,
        outcome: "exchange",
        billing_model: "fee_upfront_v1",
        clawback_cents: stakeToClaw,
        protection_id: row.id,
      },
      created_at: now,
    });
    console.log("  OK clawback stake", money(stakeToClaw));
  }

  if (feeToClaw > 0) {
    newBal -= feeToClaw;
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
      type: "protection_fee",
      amount_cents: -feeToClaw,
      ref: row.id,
      metadata: {
        tag: TAG,
        clawback_kind: "fee",
        note: `${TAG}: reverte protection_refund — Exchange mantém taxa fee_upfront`,
        outcome: "exchange",
        billing_model: "fee_upfront_v1",
        clawback_cents: feeToClaw,
        protection_id: row.id,
      },
      created_at: new Date().toISOString(),
    });
    console.log("  OK clawback fee", money(feeToClaw));
  }

  // Atualiza proteção
  const meta = metaOf(row);
  await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    body: {
      status: "won_exchange",
      settled_outcome: "exchange",
      settled_at: row.settled_at || now,
      metadata: {
        ...meta,
        realigned_to_exchange: true,
        realign_tag: TAG,
        previous_status: row.status,
        previous_settled_outcome: row.settled_outcome || null,
      },
      updated_at: now,
    },
  });
  console.log("  OK proteção → won_exchange / exchange");

  // Fecha match se ainda open
  if (match) {
    const mm = metaOf(match);
    const markets = Array.isArray(match.markets)
      ? match.markets.map((m) => ({
          ...m,
          settled_outcome: m.settled_outcome || "exchange",
        }))
      : match.markets;
    const st = String(match.status || "").toLowerCase();
    if (st === "open" || st === "live" || st === "published" || !match.settled_outcome) {
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
    } else {
      console.log("  match já", match.status, "— só reforça metadata outcome");
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        body: {
          markets,
          metadata: {
            ...mm,
            settled_outcome: mm.settled_outcome || "exchange",
            outcome: mm.outcome || "exchange",
            realign_tag: TAG,
          },
          updated_at: now,
        },
      });
    }
  }

  // tx auditoria final
  await insertTx({
    user_id: row.user_id,
    type: "protection_settlement",
    amount_cents: 0,
    ref: row.id,
    metadata: {
      tag: TAG,
      note: `${TAG}: realinhado cancelled→won_exchange (bateu Exchange)`,
      outcome: "exchange",
      exchange_no_credit: true,
      billing_model: "fee_upfront_v1",
      stake_returned: false,
      unlocked_locked: true,
      fee_kept_cents: FEE_CENTS,
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
  console.log("\nConcluído.");
  console.log(
    "  Apostador:",
    money(n(a?.balance_cents) + n(a?.reusable_balance_cents))
  );
  console.log("  Esperado Exchange fee_upfront: Reembolso R$0 · taxa retida · sem stake");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
