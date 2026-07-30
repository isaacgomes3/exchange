#!/usr/bin/env node
/**
 * Liquida eventos "A LIQUIDAR" com placar real + regra v10 (stake_lock_v1).
 *
 * Lógica de mercado (LAY = posição do cliente na casa externa):
 *   - Placar BATE a seleção LAY  → LAY perde na casa → ARBISHIELD (reembolso)
 *   - Placar NÃO bate a seleção  → LAY ganha na casa → EXCHANGE
 *
 * Eventos (29/07):
 *   1. Kauno × KÍ Women   LAY Visitante  1-0  → EXCHANGE   (visitante não venceu)
 *   2. Lech × Aarhus      LAY 3X0        1-4  → EXCHANGE   (≠ 3-0)
 *   3. Craiova × Levski   LAY 2X2        2-2  → ARBISHIELD (= 2-2 → reembolso)
 *   4. Barracas × Aldosivi LAY 2X2       1-0  → EXCHANGE   (≠ 2-2)
 *
 * Regra v10:
 *   Exchange   → devolve stake · cobra dedução · Reembolso R$0
 *   ArbiShield → stake → Saldo Reembolso · sem taxa
 *
 * Dry-run:
 *   node scripts/vps-liquidar-eventos-a-liquidar-v10.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-liquidar-eventos-a-liquidar-v10.mjs
 *
 * Marker: vps-liquidar-eventos-a-liquidar-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const TAG = "liquidar-eventos-a-liquidar-v10";

/** Planilha travada — placares de 29/07/2026 (fontes ESPN/Transfermarkt/Sofascore). */
const EVENTS = [
  {
    key: "kauno",
    homeHint: "Kauno",
    awayHint: "KÍ|KI |Klaksvik|Women",
    marketHint: /visitante|away/i,
    score: "1-0",
    outcome: "exchange",
    why: "Kauno 1-0 KÍ · LAY Visitante · visitante não venceu → LAY ganha na casa → Exchange",
  },
  {
    key: "lech",
    homeHint: "Lech",
    awayHint: "Aarhus",
    marketHint: /3\s*[x×]\s*0|3-0|3×0/i,
    score: "1-4",
    outcome: "exchange",
    why: "Lech 1-4 Aarhus · LAY 3X0 · placar ≠ 3-0 → LAY ganha na casa → Exchange",
  },
  {
    key: "craiova",
    homeHint: "Craiova",
    awayHint: "Levski",
    marketHint: /2\s*[x×]\s*2|2-2|2×2/i,
    score: "2-2",
    outcome: "arbishield",
    why: "Craiova 2-2 Levski · LAY 2X2 · placar = 2-2 → LAY perde na casa → ArbiShield (reembolso)",
  },
  {
    key: "barracas",
    homeHint: "Barracas",
    awayHint: "Aldosivi",
    marketHint: /2\s*[x×]\s*2|2-2|2×2/i,
    score: "1-0",
    outcome: "exchange",
    why: "Barracas 1-0 Aldosivi · LAY 2X2 · placar ≠ 2-2 → LAY ganha na casa → Exchange",
  },
];

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
  PROTECTION_FLOW_CONTRACT_VERSION,
  settlementDeductionCents,
  settlementCreditParts,
  settlementStatusForOutcome,
  computeArbiShieldDeductionCents,
  isFeeUpfrontProtection,
  isStakeLockProtection,
  normalizeSettleOutcome,
} = contract;

if (PROTECTION_FLOW_CONTRACT_VERSION !== "protection-flow-contract-v10") {
  console.error("ERRO: contrato não é v10:", PROTECTION_FLOW_CONTRACT_VERSION);
  process.exit(2);
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
function balType(row) {
  const m = metaOf(row);
  return String(
    m.balance_type || m.balance_type_requested || m.balanceType || "REAL"
  ).toUpperCase();
}
function originBucket(bt) {
  if (bt === "DEMO") return "demo_balance_cents";
  if (bt === "INVESTOR") return "investor_balance_cents";
  return "balance_cents";
}
function reHint(s) {
  return new RegExp(String(s || ""), "i");
}
function matchTeams(m, ev) {
  const home = String(m.home_team || m.home || "");
  const away = String(m.away_team || m.away || "");
  return reHint(ev.homeHint).test(home) && reHint(ev.awayHint).test(away);
}
function marketBlob(m) {
  const markets = Array.isArray(m.markets) ? m.markets : [];
  return JSON.stringify({
    markets,
    name: m.name,
    title: m.title,
    market_name: m.market_name,
    meta: metaOf(m),
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
    body: body != null ? JSON.stringify(body) : undefined,
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

async function sbAll(base) {
  const out = [];
  let from = 0;
  const page = 500;
  for (;;) {
    const sep = base.includes("?") ? "&" : "?";
    const rows = await sb(`${base}${sep}limit=${page}&offset=${from}`);
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < page) break;
    from += page;
    if (from > 20000) break;
  }
  return out;
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
      return sb(`/rest/v1/wallet_transactions`, { method: "POST", body: payload });
    }
    throw err;
  }
}

function rowAsStakeLock(row) {
  const meta = metaOf(row);
  return {
    ...row,
    metadata: {
      ...meta,
      billing_model: "stake_lock_v1",
      stake_lock: true,
      fee_upfront: false,
      market_type: meta.market_type || meta.side || "LAY",
      market_odd: meta.market_odd || row.odd,
    },
  };
}

async function loadPrior(protectionId) {
  const rows = await sb(
    `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
      protectionId
    )}&type=in.(protection_settlement,protection_refund,protection_fee,exchange_commission)&select=id,type,amount_cents,metadata&order=created_at.desc&limit=80`
  );
  const list = Array.isArray(rows) ? rows : [];
  let feeCharged = 0;
  let stakeReturned = 0;
  let reembolsoCredited = 0;
  let unlocked = false;
  for (const t of list) {
    const m = metaOf(t);
    const amt = n(t.amount_cents);
    // Clawbacks explícitos (não são fee nem crédito)
    if (m.clawback_reembolso_cents != null) {
      reembolsoCredited -= Math.abs(n(m.clawback_reembolso_cents) || Math.abs(amt));
      continue;
    }
    if (m.clawback_stake_cents != null) {
      stakeReturned -= Math.abs(n(m.clawback_stake_cents));
      if (m.fee_refunded_cents != null) {
        feeCharged -= Math.abs(n(m.fee_refunded_cents));
      }
      continue;
    }
    if (t.type === "protection_fee" && amt < 0) feeCharged += Math.abs(amt);
    if (t.type === "protection_settlement" && amt < 0) {
      // fee Exchange (amount negativo). Aceita mesmo se metadata.outcome sumiu.
      const looksFee =
        m.outcome === "exchange" ||
        m.exchange_no_credit === true ||
        n(m.fee_charged_now_cents) > 0 ||
        /settle exchange/i.test(String(m.note || ""));
      if (looksFee) feeCharged += Math.abs(amt);
    } else if (
      t.type === "protection_settlement" &&
      m.outcome === "exchange" &&
      !(amt < 0) &&
      n(m.fee_charged_now_cents) > 0
    ) {
      feeCharged += n(m.fee_charged_now_cents);
    }
    if (t.type === "protection_refund" && amt > 0) feeCharged -= amt;
    // Crédito Reembolso (ArbiShield)
    if (
      t.type === "protection_settlement" &&
      amt > 0 &&
      (m.outcome === "arbishield" ||
        (m.bucket === "deduction_balance_cents" && m.outcome !== "exchange"))
    ) {
      reembolsoCredited += amt;
    }
    // Stake devolvido à origem (Exchange/void) — preferir returned_stake_cents
    if (t.type === "protection_settlement" && m.stake_returned === true) {
      if (m.returned_stake_cents != null) {
        stakeReturned += Math.abs(n(m.returned_stake_cents));
      } else if (
        amt > 0 &&
        m.outcome !== "arbishield" &&
        m.bucket !== "deduction_balance_cents"
      ) {
        stakeReturned += amt;
      }
    }
    if (m.unlocked_locked === true) unlocked = true;
  }
  return {
    feeCharged: Math.max(0, feeCharged),
    stakeReturned: Math.max(0, stakeReturned),
    reembolsoCredited: Math.max(0, reembolsoCredited),
    unlocked,
    hasTx: list.length > 0,
  };
}

async function settleProtection(row, outcome, score) {
  const o = normalizeSettleOutcome(outcome);
  const now = new Date().toISOString();
  const lockRow = rowAsStakeLock(row);
  const amount = n(row.responsibility_cents || row.amount_cents);
  const fee = Math.max(
    0,
    computeArbiShieldDeductionCents(lockRow) || settlementDeductionCents(lockRow)
  );
  const parts = settlementCreditParts(lockRow, o);
  const status = settlementStatusForOutcome(o);
  const bt = balType(row);
  const prior = await loadPrior(row.id);

  // Se já liquidou como Exchange e o correto é ArbiShield: estorna stake/fee e credita Reembolso.
  if (o === "arbishield" && prior.stakeReturned > 0) {
    // clawback stake que voltou indevido ao Apostador
    const claw = prior.stakeReturned;
    const bt0 = balType(row);
    const p0 = (await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}&select=*&limit=1`
    ))?.[0];
    if (p0) {
      const now0 = new Date().toISOString();
      const patch0 = { updated_at: now0, reusable_balance_cents: 0 };
      const bucket = originBucket(bt0);
      if (bucket === "demo_balance_cents") {
        patch0.demo_balance_cents = Math.max(0, n(p0.demo_balance_cents) - claw);
      } else if (bucket === "investor_balance_cents") {
        patch0.investor_balance_cents = Math.max(0, n(p0.investor_balance_cents) - claw);
      } else {
        patch0.balance_cents = Math.max(0, n(p0.balance_cents) + n(p0.reusable_balance_cents) - claw);
      }
      // devolve fee cobrada no Exchange indevido
      if (prior.feeCharged > 0) {
        if (bucket === "demo_balance_cents") {
          patch0.demo_balance_cents = n(patch0.demo_balance_cents) + prior.feeCharged;
        } else if (bucket === "investor_balance_cents") {
          patch0.investor_balance_cents = n(patch0.investor_balance_cents) + prior.feeCharged;
        } else {
          patch0.balance_cents = n(patch0.balance_cents) + prior.feeCharged;
        }
      }
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        body: patch0,
      });
      await insertTx({
        user_id: row.user_id,
        type: "protection_settlement",
        amount_cents: -(claw - prior.feeCharged),
        ref: row.id,
        metadata: {
          tag: TAG,
          note: `${TAG}: reverte Exchange indevido → prepara ArbiShield/reembolso`,
          outcome: "arbishield",
          clawback_stake_cents: claw,
          fee_refunded_cents: prior.feeCharged,
          protection_id: row.id,
        },
      });
      prior.stakeReturned = 0;
      prior.feeCharged = 0;
    }
  }

  // Se já liquidou como ArbiShield e o correto é Exchange (ex.: Barracas/Lech LAY placar ≠ seleção):
  // remove Reembolso indevido → depois devolve stake à origem e cobra dedução.
  if (o === "exchange" && prior.reembolsoCredited > 0) {
    const clawReemb = prior.reembolsoCredited;
    const p0 = (await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}&select=*&limit=1`
    ))?.[0];
    if (p0) {
      const now0 = new Date().toISOString();
      const take = Math.min(clawReemb, Math.max(0, n(p0.deduction_balance_cents)));
      console.log(
        `  >> REVERTE ArbiShield→Exchange ${String(row.id).slice(0, 8)} remove Reembolso ${money(
          take
        )}`
      );
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        body: {
          updated_at: now0,
          deduction_balance_cents: Math.max(0, n(p0.deduction_balance_cents) - take),
        },
      });
      await insertTx({
        user_id: row.user_id,
        type: "protection_settlement",
        amount_cents: -take,
        ref: row.id,
        metadata: {
          tag: TAG,
          note: `${TAG}: reverte ArbiShield indevido → prepara Exchange (remove Reembolso)`,
          outcome: "exchange",
          clawback_reembolso_cents: take,
          bucket: "deduction_balance_cents",
          protection_id: row.id,
        },
      });
      prior.reembolsoCredited = Math.max(0, prior.reembolsoCredited - take);
      // Stake estava no Reembolso, não na origem — precisa devolver via caminho Exchange abaixo.
      prior.stakeReturned = 0;
    }
  }

  const pRows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      row.user_id
    )}&select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents,deduction_balance_cents&limit=1`
  );
  const p = Array.isArray(pRows) ? pRows[0] : null;
  if (!p) throw new Error(`perfil ${row.user_id} não encontrado`);

  const patch = { updated_at: now };
  let feeNow = 0;
  let stakeNow = 0;
  let reembNow = 0;

  // Sempre zera locked deste bilhete se ainda houver
  const locked = n(p.locked_balance_cents);
  if (amount > 0 && locked > 0) {
    patch.locked_balance_cents = Math.max(0, locked - amount);
  }

  if (o === "exchange") {
    // Devolve stake (se ainda não)
    const needStake = Math.max(0, amount - prior.stakeReturned);
    if (needStake > 0) {
      const bucket = originBucket(bt);
      if (bucket === "demo_balance_cents") {
        patch.demo_balance_cents = n(p.demo_balance_cents) + needStake;
      } else if (bucket === "investor_balance_cents") {
        patch.investor_balance_cents = n(p.investor_balance_cents) + needStake;
      } else {
        patch.reusable_balance_cents = 0;
        patch.balance_cents =
          n(p.balance_cents) + n(p.reusable_balance_cents) + needStake;
      }
      stakeNow = needStake;
    }
    // Cobra dedução faltante
    const feeDue = Math.max(0, fee - prior.feeCharged);
    if (feeDue > 0) {
      let bal =
        patch.balance_cents != null
          ? n(patch.balance_cents)
          : n(p.balance_cents) + n(p.reusable_balance_cents);
      if (bt === "DEMO") {
        const cur =
          patch.demo_balance_cents != null
            ? n(patch.demo_balance_cents)
            : n(p.demo_balance_cents);
        const take = Math.min(cur, feeDue);
        patch.demo_balance_cents = cur - take;
        feeNow = take;
      } else if (bt === "INVESTOR") {
        const cur =
          patch.investor_balance_cents != null
            ? n(patch.investor_balance_cents)
            : n(p.investor_balance_cents);
        const take = Math.min(cur, feeDue);
        patch.investor_balance_cents = cur - take;
        feeNow = take;
      } else {
        // após devolver stake, bal já inclui
        if (patch.balance_cents == null) {
          patch.balance_cents = bal + (stakeNow > 0 ? 0 : 0);
          // bal already set above if stake returned
          bal =
            patch.balance_cents != null
              ? n(patch.balance_cents)
              : n(p.balance_cents) + n(p.reusable_balance_cents);
        }
        bal = n(patch.balance_cents);
        const take = Math.min(bal, feeDue);
        patch.balance_cents = bal - take;
        patch.reusable_balance_cents = 0;
        feeNow = take;
      }
    }
  } else if (o === "arbishield") {
    const creditDue = Math.max(0, parts.total - prior.reembolsoCredited);
    if (creditDue > 0) {
      patch.deduction_balance_cents = n(p.deduction_balance_cents) + creditDue;
      reembNow = creditDue;
    }
  } else if (o === "void") {
    const needStake = Math.max(0, amount - prior.stakeReturned);
    if (needStake > 0) {
      const bucket = originBucket(bt);
      if (bucket === "demo_balance_cents") {
        patch.demo_balance_cents = n(p.demo_balance_cents) + needStake;
      } else if (bucket === "investor_balance_cents") {
        patch.investor_balance_cents = n(p.investor_balance_cents) + needStake;
      } else {
        patch.reusable_balance_cents = 0;
        patch.balance_cents =
          n(p.balance_cents) + n(p.reusable_balance_cents) + needStake;
      }
      stakeNow = needStake;
    }
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
    method: "PATCH",
    body: patch,
  });

  const txAmt =
    o === "arbishield" ? reembNow : o === "exchange" ? -feeNow : stakeNow > 0 ? stakeNow : 0;

  // Evita tx no-op que polui ledger em re-runs (stake_returned=true com R$0)
  const moved = stakeNow > 0 || feeNow > 0 || reembNow > 0;
  if (moved) {
    await insertTx({
      user_id: row.user_id,
      type: "protection_settlement",
      amount_cents: txAmt,
      ref: row.id,
      metadata: {
        tag: TAG,
        outcome: o,
        billing_model: "stake_lock_v1",
        balance_type: bt,
        stake_cents: amount,
        fee_expected_cents: fee,
        fee_charged_cents: feeNow + (o === "exchange" ? prior.feeCharged : 0),
        fee_charged_now_cents: feeNow,
        returned_stake_cents: stakeNow,
        stake_returned: stakeNow > 0,
        unlock_return_to_origin: o === "exchange" || o === "void",
        unlocked_locked: true,
        exchange_no_credit: o === "exchange",
        bucket: o === "arbishield" ? "deduction_balance_cents" : originBucket(bt),
        final_score: score,
        protection_id: row.id,
        match_id: row.match_id || null,
        table: row._table,
        note: `${TAG}: settle ${o} v10 placar ${score}`,
      },
    });
  }

  // status proteção
  const attempts = [
    { status, settled_at: now, settled_outcome: o },
    { status, settled_at: now },
  ];
  if (o === "arbishield") {
    attempts.push({
      status: "won_platform",
      settled_at: now,
      settled_outcome: "arbishield",
    });
  }
  let ok = false;
  for (const body of attempts) {
    try {
      await sb(`/rest/v1/${row._table}?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: {
          ...body,
          platform_deduction_cents: fee,
          metadata: {
            ...metaOf(row),
            billing_model: "stake_lock_v1",
            stake_lock: true,
            settled_by_tag: TAG,
            final_score: score,
          },
        },
      });
      ok = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!ok) throw new Error(`falha ao PATCH proteção ${row.id}`);

  return {
    name: p.full_name,
    amount,
    fee,
    feeNow,
    stakeNow,
    reembNow,
    status,
    outcome: o,
  };
}

async function closeMatch(match, outcome, score) {
  const now = new Date().toISOString();
  const mm = metaOf(match);
  const markets = Array.isArray(match.markets)
    ? match.markets.map((m) => ({ ...m, settled_outcome: outcome }))
    : match.markets;
  await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(match.id)}`, {
    method: "PATCH",
    body: {
      status: "settled",
      is_published: false,
      final_score: score,
      settled_at: now,
      markets,
      metadata: {
        ...mm,
        settled_outcome: outcome,
        outcome,
        final_score: score,
        settled_by_tag: TAG,
      },
      updated_at: now,
    },
  });
}

async function main() {
  console.log("==> Liquidar eventos A LIQUIDAR (v10 / stake_lock_v1)");
  console.log("    contrato:", PROTECTION_FLOW_CONTRACT_VERSION);
  console.log("    FIX:", FIX ? "SIM" : "não (dry-run)");

  const matches = await sbAll(
    `/rest/v1/matches?select=*&order=starts_at.desc`
  );
  console.log("  matches carregados:", matches.length);

  const plan = [];

  for (const ev of EVENTS) {
    const candidates = matches.filter((m) => matchTeams(m, ev));
    let match =
      candidates.find((m) => ev.marketHint.test(marketBlob(m))) ||
      candidates[0] ||
      null;
    if (!match) {
      console.log(`\nXX ${ev.key}: partida NÃO encontrada (${ev.homeHint}×${ev.awayHint})`);
      continue;
    }

    const [lays, backs] = await Promise.all([
      sb(
        `/rest/v1/protections?match_id=eq.${encodeURIComponent(
          match.id
        )}&select=*&limit=100`
      ),
      sb(
        `/rest/v1/back_protections?match_id=eq.${encodeURIComponent(
          match.id
        )}&select=*&limit=100`
      ).catch(() => []),
    ]);
    const all = [
      ...(Array.isArray(lays) ? lays.map((r) => ({ ...r, _table: "protections" })) : []),
      ...(Array.isArray(backs)
        ? backs.map((r) => ({ ...r, _table: "back_protections" }))
        : []),
    ];
    const open = all.filter((r) => {
      const st = String(r.status || "").toLowerCase();
      return (
        !st ||
        ["active", "pending", "review_odd", "open", "cancelled", "canceled"].includes(
          st
        ) ||
        // reprocessa liquidados incompletos / outcome invertido (Barracas lost_exchange→Exchange)
        [
          "won_exchange",
          "lost_exchange",
          "won_platform",
          "lost_platform",
          "void",
          "settled",
        ].includes(st)
      );
    });

    plan.push({ ev, match, protections: open, all });
  }

  console.log("\n==== PLANO ====");
  for (const item of plan) {
    const { ev, match, protections, all } = item;
    console.log(
      `\n• ${match.home_team || "?"} × ${match.away_team || "?"}  [${ev.key}]`
    );
    console.log(`  match_id: ${match.id}`);
    console.log(`  status match: ${match.status}`);
    console.log(`  placar: ${ev.score} → outcome ${ev.outcome.toUpperCase()}`);
    console.log(`  motivo: ${ev.why}`);
    console.log(`  proteções (${protections.length}/${all.length}):`);
    for (const r of protections) {
      const amount = n(r.responsibility_cents || r.amount_cents);
      const fee = settlementDeductionCents(rowAsStakeLock(r));
      const parts = settlementCreditParts(rowAsStakeLock(r), ev.outcome);
      let name = r.user_id?.slice?.(0, 8) || "?";
      try {
        const pr = await sb(
          `/rest/v1/profiles?id=eq.${encodeURIComponent(
            r.user_id
          )}&select=full_name&limit=1`
        );
        name = pr?.[0]?.full_name || name;
      } catch {
        /* */
      }
      console.log(
        `    - ${String(r.id).slice(0, 8)}  ${r.status}  ${money(amount)}  fee=${money(
          fee
        )}  credit=${money(parts.total)}  ${name}`
      );
    }
  }

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para liquidar conforme o plano.");
    return;
  }

  console.log("\n==== APLICANDO ====");
  let ok = 0;
  let fail = 0;
  for (const item of plan) {
    const { ev, match, protections } = item;
    console.log(`\n→ ${ev.key} (${ev.outcome}) placar ${ev.score}`);
    for (const r of protections) {
      try {
        // Skip cancelled clean fee_upfront that already refunded fee only — still settle if open protection list includes cancelled wrongly
        const st = String(r.status || "").toLowerCase();
        const result = await settleProtection(r, ev.outcome, ev.score);
        console.log(
          `  OK ${String(r.id).slice(0, 8)} ${result.name} ${ev.outcome} stake=${money(
            result.stakeNow
          )} fee=${money(result.feeNow)} reemb=${money(result.reembNow)} (era ${st})`
        );
        ok += 1;
      } catch (err) {
        fail += 1;
        console.error(
          `  FAIL ${String(r.id).slice(0, 8)}`,
          err instanceof Error ? err.message : err
        );
      }
    }
    try {
      await closeMatch(match, ev.outcome, ev.score);
      console.log(`  OK match fechado ${match.id.slice(0, 8)} → settled/${ev.outcome}`);
    } catch (err) {
      fail += 1;
      console.error(
        `  FAIL match`,
        err instanceof Error ? err.message : err
      );
    }
  }
  console.log(`\nConcluído: ${ok} proteções ok · ${fail} falhas`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
