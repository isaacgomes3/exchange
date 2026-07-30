#!/usr/bin/env node
/**
 * Reparo em lote — proteções liquidadas com regras ERRADAS num dia (BRT).
 *
 * Fonte de verdade: protection-flow-contract-v10 / stake_lock_v1
 *
 * Corrige:
 *   Exchange (won_exchange):
 *     - stake não devolvido / locked preso
 *     - dedução não cobrada ou fee com odd errada
 *     - crédito indevido no Saldo Reembolso (clawback → Apostador)
 *     - comissão 4,5% debitada de novo na carteira (estorna)
 *   ArbiShield (lost_exchange):
 *     - stake não creditado no Saldo Reembolso / locked preso
 *   Empate Anula / void:
 *     - stake não devolvido à origem / locked preso
 *
 * Dry-run (padrão):
 *   DAY=2026-07-29 node scripts/vps-reparar-protecoes-dia-v10.mjs
 *
 * Aplicar:
 *   DAY=2026-07-29 FIX=1 node scripts/vps-reparar-protecoes-dia-v10.mjs
 *
 * Marker: vps-reparar-protecoes-dia-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const TAG = "repair-protecoes-dia-v10";
const PAGE = Math.min(1000, Number(process.env.PAGE_SIZE || 500));

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
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
  return true;
}

for (const f of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  "/opt/arbishield/scripts/.env",
  "/root/.arbishield.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean)) {
  loadEnvFile(f);
}

const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente (rode na VPS ou exporte a key)");
  process.exit(1);
}

const contract = await import(
  pathToFileURL(path.resolve(__dirname, "lib/protection-flow-contract.mjs")).href
);

const {
  PROTECTION_FLOW_CONTRACT_VERSION,
  settlementDeductionCents,
  settlementOutcomeFromProtectionRow,
  settlementCreditParts,
  isStakeLockProtection,
  isFeeUpfrontProtection,
  exchangeWalletHealNeeded,
  isExchangeWalletComplete,
  settlementExchangeCommissionWalletCents,
  creditBucketForSettlement,
  normalizeSettleOutcome,
} = contract;

if (PROTECTION_FLOW_CONTRACT_VERSION !== "protection-flow-contract-v10") {
  console.error(
    "ERRO: contrato não é v10 —",
    PROTECTION_FLOW_CONTRACT_VERSION
  );
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
function dayBounds(dayStr) {
  const day =
    dayStr ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    })();
  const fromIso = new Date(`${day}T00:00:00-03:00`).toISOString();
  const toIso = new Date(`${day}T23:59:59.999-03:00`).toISOString();
  return { day, fromIso, toIso };
}
function balanceTypeOf(row) {
  const meta = metaOf(row);
  return String(
    meta.balance_type ||
      meta.balance_type_requested ||
      meta.balanceType ||
      "REAL"
  ).toUpperCase();
}

async function sb(p, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
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
  if (!res.ok) {
    throw new Error(`${res.status} ${p}\n${String(text).slice(0, 600)}`);
  }
  return data;
}

async function sbAll(basePath) {
  const out = [];
  let from = 0;
  for (;;) {
    const sep = basePath.includes("?") ? "&" : "?";
    const rows = await sb(
      `${basePath}${sep}limit=${PAGE}&offset=${from}`
    );
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < PAGE) break;
    from += PAGE;
    if (from > 50000) break;
  }
  return out;
}

async function loadExchangePrior(protectionId) {
  const empty = {
    feeCharged: 0,
    feeShortfall: 0,
    unlocked: false,
    stakeReturned: false,
    hasTx: false,
    commissionCharged: 0,
    reembolsoCredited: 0,
  };
  if (!protectionId) return empty;
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
        protectionId
      )}&type=in.(protection_settlement,exchange_commission,protection_refund,protection_release)&select=id,type,amount_cents,metadata&order=created_at.desc&limit=80`
    );
    const list = Array.isArray(rows) ? rows : [];
    let feeCharged = 0;
    let feeShortfall = 0;
    let unlocked = false;
    let stakeReturned = false;
    let hasTx = false;
    let commissionCharged = 0;
    let reembolsoCredited = 0;
    for (const t of list) {
      const meta = metaOf(t);
      const typ = String(t.type || "");
      const amt = n(t.amount_cents);
      if (typ === "exchange_commission") {
        commissionCharged += Math.abs(amt);
        hasTx = true;
        continue;
      }
      const oc = String(meta.outcome || meta.settled_outcome || "").toLowerCase();
      if (typ === "protection_settlement" || typ === "protection_refund") {
        hasTx = true;
        if (oc === "exchange" || oc === "won_exchange" || meta.exchange_no_credit) {
          feeCharged += Math.max(0, n(meta.fee_charged_cents));
          if (!(n(meta.fee_charged_cents) > 0) && amt < 0) {
            feeCharged += Math.abs(amt);
          }
          feeShortfall = Math.max(feeShortfall, n(meta.fee_shortfall_cents));
          if (meta.unlocked_locked === true) unlocked = true;
          if (
            meta.stake_returned === true ||
            n(meta.returned_stake_cents) > 0 ||
            meta.unlock_return_to_origin === true
          ) {
            stakeReturned = true;
          }
          commissionCharged += Math.max(
            0,
            n(meta.exchange_commission_charged_cents)
          );
          // crédito positivo em Reembolso no settle Exchange = indevido
          if (amt > 0 && (meta.bucket === "deduction_balance_cents" || !meta.stake_returned)) {
            if (oc === "exchange" || oc === "won_exchange") {
              reembolsoCredited += amt;
            }
          }
        } else if (oc === "arbishield" || oc === "lost_exchange") {
          if (amt > 0) reembolsoCredited += 0; // tracked separately for arbi
        }
      }
      if (meta.unlocked_locked === true) unlocked = true;
      if (
        meta.stake_returned === true ||
        n(meta.returned_stake_cents) > 0 ||
        meta.unlock_return_to_origin === true
      ) {
        stakeReturned = true;
      }
    }
    return {
      feeCharged,
      feeShortfall,
      unlocked,
      stakeReturned,
      hasTx,
      commissionCharged,
      reembolsoCredited,
    };
  } catch {
    return empty;
  }
}

async function loadArbiPrior(protectionId) {
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(
        protectionId
      )}&type=in.(protection_settlement,protection_refund,protection_release)&select=id,type,amount_cents,metadata&order=created_at.desc&limit=40`
    );
    const list = Array.isArray(rows) ? rows : [];
    let credited = 0;
    let unlocked = false;
    let hasTx = false;
    for (const t of list) {
      const meta = metaOf(t);
      const oc = String(meta.outcome || "").toLowerCase();
      if (oc && oc !== "arbishield" && oc !== "lost_exchange") continue;
      hasTx = true;
      const amt = n(t.amount_cents);
      if (amt > 0) credited += amt;
      if (meta.unlocked_locked === true) unlocked = true;
    }
    return { credited, unlocked, hasTx };
  } catch {
    return { credited: 0, unlocked: false, hasTx: false };
  }
}

async function loadProfile(userId) {
  const rows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      userId
    )}&select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents,deduction_balance_cents&limit=1`
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function insertTx(body) {
  return sb(`/rest/v1/wallet_transactions`, { method: "POST", body });
}

async function patchProfile(userId, patch) {
  return sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: patch,
  });
}

function originBucket(bt) {
  if (bt === "DEMO") return "demo_balance_cents";
  if (bt === "INVESTOR") return "investor_balance_cents";
  return "balance_cents";
}

/**
 * Aplica patch de carteira para Exchange incompleto (v10).
 * Devolve stake + cobra fee faltante + destrava.
 */
async function fixExchange(row, prior, feeExpected) {
  const amount = n(row.responsibility_cents || row.amount_cents);
  const bt = balanceTypeOf(row);
  const feeUpfront = isFeeUpfrontProtection(row);
  const stakeLock = isStakeLockProtection(row);
  const needsUnlock = (stakeLock || !feeUpfront) && amount > 0;
  const needsReturn = stakeLock && !feeUpfront && amount > 0;
  const feeStillDue = Math.max(
    0,
    feeExpected - n(prior.feeCharged) - n(prior.feeShortfall)
  );
  // Comissão wallet deve ser 0 no v10 — se cobrou, devolve
  const commissionWallet = settlementExchangeCommissionWalletCents(row);
  const commissionToRefund = Math.max(
    0,
    n(prior.commissionCharged) - commissionWallet
  );

  const p = await loadProfile(row.user_id);
  if (!p) throw new Error(`perfil ${row.user_id} não encontrado`);

  const now = new Date().toISOString();
  const patch = { updated_at: now };
  let unlocked = !!prior.unlocked;
  let stakeReturned = !!prior.stakeReturned;
  let feeChargedNow = 0;

  if (needsUnlock && !unlocked) {
    patch.locked_balance_cents = Math.max(0, n(p.locked_balance_cents) - amount);
    unlocked = true;
  }

  if (needsReturn && !stakeReturned) {
    const bucket = originBucket(bt);
    if (bucket === "demo_balance_cents") {
      patch.demo_balance_cents = n(p.demo_balance_cents) + amount;
    } else if (bucket === "investor_balance_cents") {
      patch.investor_balance_cents = n(p.investor_balance_cents) + amount;
    } else {
      patch.reusable_balance_cents = 0;
      patch.balance_cents =
        n(p.balance_cents) + n(p.reusable_balance_cents) + amount;
    }
    stakeReturned = true;
  }

  // Clawback crédito indevido Reembolso → origem (Exchange nunca credita Reembolso)
  let clawback = 0;
  if (n(prior.reembolsoCredited) > 0) {
    clawback = n(prior.reembolsoCredited);
    const ded =
      patch.deduction_balance_cents != null
        ? n(patch.deduction_balance_cents)
        : n(p.deduction_balance_cents);
    const take = Math.min(ded, clawback);
    patch.deduction_balance_cents = ded - take;
    const bucket = originBucket(bt);
    if (bucket === "demo_balance_cents") {
      const base =
        patch.demo_balance_cents != null
          ? n(patch.demo_balance_cents)
          : n(p.demo_balance_cents);
      patch.demo_balance_cents = base + take;
    } else if (bucket === "investor_balance_cents") {
      const base =
        patch.investor_balance_cents != null
          ? n(patch.investor_balance_cents)
          : n(p.investor_balance_cents);
      patch.investor_balance_cents = base + take;
    } else {
      const base =
        patch.balance_cents != null
          ? n(patch.balance_cents)
          : n(p.balance_cents) + n(p.reusable_balance_cents);
      patch.reusable_balance_cents = 0;
      patch.balance_cents = base + take;
    }
  }

  // Devolve comissão wallet indevida
  if (commissionToRefund > 0) {
    const bucket = originBucket(bt);
    if (bucket === "demo_balance_cents") {
      const base =
        patch.demo_balance_cents != null
          ? n(patch.demo_balance_cents)
          : n(p.demo_balance_cents);
      patch.demo_balance_cents = base + commissionToRefund;
    } else if (bucket === "investor_balance_cents") {
      const base =
        patch.investor_balance_cents != null
          ? n(patch.investor_balance_cents)
          : n(p.investor_balance_cents);
      patch.investor_balance_cents = base + commissionToRefund;
    } else {
      const base =
        patch.balance_cents != null
          ? n(patch.balance_cents)
          : n(p.balance_cents) + n(p.reusable_balance_cents);
      patch.reusable_balance_cents = 0;
      patch.balance_cents = base + commissionToRefund;
    }
  }

  // Cobra fee faltante (após devolver stake)
  if (stakeLock && !feeUpfront && feeStillDue > 0) {
    let left = feeStillDue;
    if (bt === "DEMO") {
      const cur =
        patch.demo_balance_cents != null
          ? n(patch.demo_balance_cents)
          : n(p.demo_balance_cents);
      const take = Math.min(cur, left);
      patch.demo_balance_cents = cur - take;
      feeChargedNow = take;
      left -= take;
    } else if (bt === "INVESTOR") {
      const cur =
        patch.investor_balance_cents != null
          ? n(patch.investor_balance_cents)
          : n(p.investor_balance_cents);
      const take = Math.min(cur, left);
      patch.investor_balance_cents = cur - take;
      feeChargedNow = take;
      left -= take;
    } else {
      let bal =
        patch.balance_cents != null
          ? n(patch.balance_cents)
          : n(p.balance_cents) + n(p.reusable_balance_cents);
      let ded =
        patch.deduction_balance_cents != null
          ? n(patch.deduction_balance_cents)
          : n(p.deduction_balance_cents);
      patch.reusable_balance_cents = 0;
      if (bal >= left) {
        patch.balance_cents = bal - left;
        patch.deduction_balance_cents = ded;
        feeChargedNow = left;
        left = 0;
      } else {
        left -= bal;
        const takeDed = Math.min(ded, left);
        patch.balance_cents = 0;
        patch.deduction_balance_cents = ded - takeDed;
        feeChargedNow = bal + takeDed;
        left -= takeDed;
      }
    }
  }

  await patchProfile(row.user_id, patch);
  await insertTx({
    user_id: row.user_id,
    type: "protection_settlement",
    amount_cents: feeChargedNow > 0 ? -feeChargedNow : 0,
    balance_type: bt,
    ref: row.id,
    note: `${TAG}: heal Exchange v10 (devolve stake · cobra só dedução · Reembolso R$0)`,
    metadata: {
      tag: TAG,
      outcome: "exchange",
      billing_model: "stake_lock_v1",
      fee_expected_cents: feeExpected,
      fee_charged_cents: feeChargedNow + n(prior.feeCharged),
      fee_charged_now_cents: feeChargedNow,
      unlocked_locked: unlocked,
      stake_returned: stakeReturned,
      returned_stake_cents: needsReturn ? amount : 0,
      unlock_return_to_origin: needsReturn,
      exchange_no_credit: true,
      clawback_reembolso_cents: clawback,
      commission_refunded_cents: commissionToRefund,
      exchange_commission_charged_cents: 0,
      protection_id: row.id,
      table: row._table,
    },
    created_at: now,
  });

  return {
    unlocked,
    stakeReturned,
    feeChargedNow,
    clawback,
    commissionToRefund,
  };
}

async function fixArbiShield(row, prior) {
  const amount = n(row.responsibility_cents || row.amount_cents);
  const parts = settlementCreditParts(row, "arbishield");
  const creditDue = Math.max(0, parts.total - n(prior.credited));
  const bt = balanceTypeOf(row);
  const p = await loadProfile(row.user_id);
  if (!p) throw new Error(`perfil ${row.user_id} não encontrado`);
  const now = new Date().toISOString();
  const patch = { updated_at: now };
  let unlocked = !!prior.unlocked;

  if (amount > 0 && !unlocked) {
    patch.locked_balance_cents = Math.max(0, n(p.locked_balance_cents) - amount);
    unlocked = true;
  }
  if (creditDue > 0) {
    patch.deduction_balance_cents = n(p.deduction_balance_cents) + creditDue;
  }
  await patchProfile(row.user_id, patch);
  if (creditDue > 0 || unlocked) {
    await insertTx({
      user_id: row.user_id,
      type: "protection_settlement",
      amount_cents: creditDue,
      balance_type: bt,
      ref: row.id,
      note: `${TAG}: heal ArbiShield v10 (stake → Saldo Reembolso)`,
      metadata: {
        tag: TAG,
        outcome: "arbishield",
        billing_model: "stake_lock_v1",
        bucket: "deduction_balance_cents",
        unlocked_locked: unlocked,
        protection_id: row.id,
        table: row._table,
      },
      created_at: now,
    });
  }
  return { creditDue, unlocked };
}

async function fixVoid(row, prior) {
  const amount = n(row.responsibility_cents || row.amount_cents);
  const feeUpfront = isFeeUpfrontProtection(row);
  const parts = settlementCreditParts(row, "void");
  const bt = balanceTypeOf(row);
  const p = await loadProfile(row.user_id);
  if (!p) throw new Error(`perfil ${row.user_id} não encontrado`);
  const now = new Date().toISOString();
  const patch = { updated_at: now };
  let unlocked = !!prior.unlocked;
  let returned = !!prior.stakeReturned;

  if (amount > 0 && !unlocked) {
    patch.locked_balance_cents = Math.max(0, n(p.locked_balance_cents) - amount);
    unlocked = true;
  }

  // stake_lock void → devolve à origem; fee_upfront void → só fee no Reembolso
  if (!feeUpfront && amount > 0 && !returned) {
    const bucket = originBucket(bt);
    if (bucket === "demo_balance_cents") {
      patch.demo_balance_cents = n(p.demo_balance_cents) + amount;
    } else if (bucket === "investor_balance_cents") {
      patch.investor_balance_cents = n(p.investor_balance_cents) + amount;
    } else {
      patch.reusable_balance_cents = 0;
      patch.balance_cents =
        n(p.balance_cents) + n(p.reusable_balance_cents) + amount;
    }
    returned = true;
  } else if (feeUpfront && parts.total > 0 && n(prior.credited || 0) < parts.total) {
    const due = parts.total - n(prior.credited || 0);
    patch.deduction_balance_cents = n(p.deduction_balance_cents) + due;
  }

  await patchProfile(row.user_id, patch);
  await insertTx({
    user_id: row.user_id,
    type: "protection_settlement",
    amount_cents: 0,
    balance_type: bt,
    ref: row.id,
    note: `${TAG}: heal void/Empate Anula v10 (destrava e devolve)`,
    metadata: {
      tag: TAG,
      outcome: "void",
      billing_model: feeUpfront ? "fee_upfront_v1" : "stake_lock_v1",
      unlocked_locked: unlocked,
      stake_returned: returned,
      returned_stake_cents: !feeUpfront ? amount : 0,
      unlock_return_to_origin: !feeUpfront,
      protection_id: row.id,
      table: row._table,
    },
    created_at: now,
  });
  return { unlocked, returned };
}

async function fetchDayProtections(fromIso, toIso) {
  const select =
    "id,user_id,match_id,status,settled_outcome,settled_at,created_at,amount_cents,responsibility_cents,odd,platform_deduction_cents,platform_profit_cents,locked_deduction_cents,exchange_fee_cents,metadata";
  const statusIn =
    "won_exchange,lost_exchange,won_platform,lost_platform,settled,void,cancelled,canceled";

  const [laysBySettle, backsBySettle, laysByCreate, backsByCreate] =
    await Promise.all([
      sbAll(
        `/rest/v1/protections?select=${select}&settled_at=gte.${encodeURIComponent(
          fromIso
        )}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
      ).catch(() => []),
      sbAll(
        `/rest/v1/back_protections?select=${select}&settled_at=gte.${encodeURIComponent(
          fromIso
        )}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
      ).catch(() => []),
      // fallback: status terminal criado no dia (se settled_at nulo)
      sbAll(
        `/rest/v1/protections?select=${select}&status=in.(${statusIn})&created_at=gte.${encodeURIComponent(
          fromIso
        )}&created_at=lte.${encodeURIComponent(toIso)}&order=created_at.asc`
      ).catch(() => []),
      sbAll(
        `/rest/v1/back_protections?select=${select}&status=in.(${statusIn})&created_at=gte.${encodeURIComponent(
          fromIso
        )}&created_at=lte.${encodeURIComponent(toIso)}&order=created_at.asc`
      ).catch(() => []),
    ]);

  const map = new Map();
  for (const r of laysBySettle) map.set(r.id, { ...r, _table: "protections" });
  for (const r of backsBySettle)
    map.set(r.id, { ...r, _table: "back_protections" });
  for (const r of laysByCreate) {
    if (!map.has(r.id)) map.set(r.id, { ...r, _table: "protections" });
  }
  for (const r of backsByCreate) {
    if (!map.has(r.id)) map.set(r.id, { ...r, _table: "back_protections" });
  }
  return [...map.values()];
}

async function main() {
  const { day, fromIso, toIso } = dayBounds(process.env.DAY || "");
  console.log("==> Reparo proteções do dia (v10 / stake_lock_v1)");
  console.log("    DAY:", day, `(${fromIso} → ${toIso})`);
  console.log("    FIX:", FIX ? "SIM" : "não (dry-run)");
  console.log("    contrato:", PROTECTION_FLOW_CONTRACT_VERSION);
  console.log("    supabase:", SUPABASE_URL);

  const rows = await fetchDayProtections(fromIso, toIso);
  console.log("\n  proteções no dia:", rows.length);

  const names = new Map();
  const issues = [];

  for (const row of rows) {
    const outcome = settlementOutcomeFromProtectionRow(row);
    if (!outcome) continue;
    const amount = n(row.responsibility_cents || row.amount_cents);
    const fee = settlementDeductionCents(row);
    const meta = metaOf(row);
    const billing =
      meta.billing_model ||
      (isFeeUpfrontProtection(row) ? "fee_upfront_v1" : "stake_lock_v1");

    if (!names.has(row.user_id)) {
      const p = await loadProfile(row.user_id);
      names.set(row.user_id, p?.full_name || row.user_id.slice(0, 8));
    }
    const name = names.get(row.user_id);

    if (outcome === "exchange") {
      const prior = await loadExchangePrior(row.id);
      const stakeLock = isStakeLockProtection(row);
      const feeUpfront = isFeeUpfrontProtection(row);
      const needsUnlock = (stakeLock || !feeUpfront) && amount > 0;
      const needsReturn = stakeLock && !feeUpfront && amount > 0;
      const heal = exchangeWalletHealNeeded(row, {
        hasTx: prior.hasTx,
        feeCharged: prior.feeCharged,
        feeShortfall: prior.feeShortfall,
        unlocked: prior.unlocked,
        stakeReturned: prior.stakeReturned,
      });
      const complete = isExchangeWalletComplete({
        feeUpfront,
        feeExpected: fee,
        feeCharged: prior.feeCharged,
        feeShortfall: prior.feeShortfall,
        unlocked: prior.unlocked || !needsUnlock,
        needsUnlock,
        stakeReturned: prior.stakeReturned || !needsReturn,
        needsReturn,
      });
      const badReembolso = n(prior.reembolsoCredited) > 0;
      const badCommission = n(prior.commissionCharged) > 0;
      if (heal || !complete || badReembolso || badCommission) {
        issues.push({
          kind: "exchange",
          row,
          name,
          amount,
          fee,
          billing,
          prior,
          reasons: [
            !prior.stakeReturned && needsReturn ? "stake_nao_devolvido" : null,
            !prior.unlocked && needsUnlock ? "locked_preso" : null,
            fee > prior.feeCharged + prior.feeShortfall ? "fee_faltando" : null,
            badReembolso ? `reembolso_indevido_${prior.reembolsoCredited}` : null,
            badCommission
              ? `comissao_wallet_indevida_${prior.commissionCharged}`
              : null,
            !prior.hasTx ? "sem_tx_settle" : null,
          ].filter(Boolean),
        });
      }
      continue;
    }

    if (outcome === "arbishield") {
      const prior = await loadArbiPrior(row.id);
      const parts = settlementCreditParts(row, "arbishield");
      const due = Math.max(0, parts.total - n(prior.credited));
      if (due > 0 || (amount > 0 && !prior.unlocked && isStakeLockProtection(row))) {
        issues.push({
          kind: "arbishield",
          row,
          name,
          amount,
          fee,
          billing,
          prior,
          creditDue: due,
          reasons: [
            due > 0 ? `credito_reembolso_faltando_${due}` : null,
            !prior.unlocked ? "locked_preso" : null,
          ].filter(Boolean),
        });
      }
      continue;
    }

    if (outcome === "void") {
      const prior = await loadExchangePrior(row.id); // reuse unlock/return flags
      const arbiPrior = await loadArbiPrior(row.id);
      const feeUpfront = isFeeUpfrontProtection(row);
      const needReturn = !feeUpfront && amount > 0 && !prior.stakeReturned;
      const needUnlock = amount > 0 && !prior.unlocked;
      if (needReturn || needUnlock) {
        issues.push({
          kind: "void",
          row,
          name,
          amount,
          fee,
          billing,
          prior: { ...prior, credited: arbiPrior.credited },
          reasons: [
            needReturn ? "stake_nao_devolvido" : null,
            needUnlock ? "locked_preso" : null,
          ].filter(Boolean),
        });
      }
    }
  }

  console.log("\n  com problema:", issues.length);
  if (!issues.length) {
    console.log("\nOK — nenhuma proteção do dia precisa de reparo v10.");
    return;
  }

  console.log("\n---- relatório ----");
  for (const it of issues) {
    console.log(
      [
        it.kind.padEnd(10),
        it.row._table.slice(0, 4),
        String(it.row.id).slice(0, 8),
        money(it.amount).padStart(12),
        `fee=${money(it.fee)}`,
        it.billing,
        it.name,
        it.reasons.join(","),
      ].join("  ")
    );
  }

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para aplicar os reparos.");
    console.log(
      `  DAY=${day} FIX=1 node scripts/vps-reparar-protecoes-dia-v10.mjs`
    );
    return;
  }

  console.log("\n---- aplicando FIX ----");
  let ok = 0;
  let fail = 0;
  for (const it of issues) {
    try {
      if (it.kind === "exchange") {
        const r = await fixExchange(it.row, it.prior, it.fee);
        console.log(
          "  OK exchange",
          it.row.id.slice(0, 8),
          "return=",
          r.stakeReturned,
          "feeNow=",
          money(r.feeChargedNow),
          "clawback=",
          money(r.clawback)
        );
      } else if (it.kind === "arbishield") {
        const r = await fixArbiShield(it.row, it.prior);
        console.log(
          "  OK arbishield",
          it.row.id.slice(0, 8),
          "credit=",
          money(r.creditDue)
        );
      } else if (it.kind === "void") {
        const r = await fixVoid(it.row, it.prior);
        console.log(
          "  OK void",
          it.row.id.slice(0, 8),
          "returned=",
          r.returned
        );
      }
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(
        "  FAIL",
        it.row.id.slice(0, 8),
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  console.log(`\nConcluído: ${ok} ok · ${fail} falhas`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
