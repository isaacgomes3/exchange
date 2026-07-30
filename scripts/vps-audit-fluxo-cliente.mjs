#!/usr/bin/env node
/**
 * Auditoria fluxo cliente — depósitos, proteções, fees, settle, carteiras.
 * Mesma linha do caso Lucas: ops que não deduziram, creditaram errado ou
 * PERDEU com crédito indevido no Saldo Reembolso.
 *
 * Uso:
 *   NAME="AUGUSTO LUIZ" ID_PREFIX=8b2cd8a3 node scripts/vps-audit-fluxo-cliente.mjs
 *   USER_ID=uuid node scripts/vps-audit-fluxo-cliente.mjs
 *
 * Marker: vps-audit-fluxo-cliente-v1
 */
import fs from "node:fs";
import path from "node:path";
import {
  calcLay,
  calcBack,
  settlementCreditParts,
  settlementDeductionCents,
} from "./lib/protection-flow-contract.mjs";

const NAME = String(process.env.NAME || process.env.FULL_NAME || "").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || process.env.ID || "")
  .trim()
  .toLowerCase();
const USER_ID = String(process.env.USER_ID || "").trim();

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
if (!USER_ID && !ID_PREFIX && !NAME) {
  console.error("Informe USER_ID=, ID_PREFIX= ou NAME=");
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
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
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
function isFeeUpfront(row) {
  const meta = metaOf(row);
  return (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  );
}
function outcomeOf(row) {
  const o = String(row.settled_outcome || "").toLowerCase();
  if (["arbishield", "won", "win", "user_won"].includes(o)) return "arbishield";
  if (["exchange", "lost", "loss"].includes(o)) return "exchange";
  const st = String(row.status || "").toLowerCase();
  if (st === "lost_exchange") return "arbishield";
  if (st === "won_exchange") return "exchange";
  if (st === "void") return "void";
  return o || st || "";
}
function isSettled(row) {
  const st = String(row.status || "").toLowerCase();
  return (
    !!row.settled_at ||
    ["settled", "won", "lost", "void", "refunded", "cancelled", "won_exchange", "lost_exchange"].some(
      (s) => st.includes(s)
    )
  );
}

async function sb(p, { method = "GET", body, okNull = false } = {}) {
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
  if (!res.ok) {
    if (okNull) return null;
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 320)}`);
  }
  return data;
}

async function sbTry(paths, { optional = false } = {}) {
  let last = null;
  for (const p of paths) {
    try {
      return await sb(p);
    } catch (e) {
      last = e;
      if (optional) continue;
    }
  }
  if (optional) return [];
  if (last) throw last;
  return null;
}

function expectedFeeCents(row) {
  const meta = metaOf(row);
  const stake = n(row.responsibility_cents || row.amount_cents);
  const odd = n(row.odd || meta.market_odd || meta.odd);
  const side = String(row.side || meta.market_type || meta.side || "LAY").toUpperCase();
  const onRow = n(
    row.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row.locked_deduction_cents != null
        ? row.locked_deduction_cents
        : meta.fee_charged_cents
  );
  if (onRow > 0) return onRow;
  if (!(stake > 0) || !(odd > 1.01)) return settlementDeductionCents(row);
  try {
    const c = side === "BACK" ? calcBack(stake, odd) : calcLay(stake, odd);
    return n(c.arbiShieldDeductionCents);
  } catch {
    return settlementDeductionCents(row);
  }
}

function expectedSettleCredit(row) {
  const out = outcomeOf(row);
  if (!out || out === "void") {
    return settlementCreditParts(row, out || "void").total;
  }
  return settlementCreditParts(row, out).total;
}

async function resolveUser() {
  if (USER_ID) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key,created_at&id=eq.${encodeURIComponent(USER_ID)}`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  const want = norm(NAME);
  let rows = [];
  if (ID_PREFIX) {
    rows = await sbTry([
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key,created_at&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`,
    ]);
  }
  if ((!rows || !rows.length) && NAME) {
    const first = NAME.split(/\s+/)[0];
    rows = await sbTry([
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key,created_at&full_name=ilike.*${encodeURIComponent(first)}*&limit=50`,
    ]);
  }
  rows = Array.isArray(rows) ? rows : [];
  if (want) {
    rows = rows.filter((r) => {
      const nm = norm(r.full_name);
      return (
        (ID_PREFIX && String(r.id).toLowerCase().startsWith(ID_PREFIX)) ||
        nm.includes(want) ||
        want.includes(nm)
      );
    });
  } else if (ID_PREFIX) {
    rows = rows.filter((r) =>
      String(r.id).toLowerCase().startsWith(ID_PREFIX)
    );
  }
  if (!rows.length) {
    console.error("ERRO: perfil não encontrado");
    process.exit(2);
  }
  if (rows.length > 1) {
    console.log("!! múltiplos perfis:");
    rows.forEach((r) => console.log("   ", r.id, r.full_name));
    if (ID_PREFIX) {
      rows = rows.filter((r) =>
        String(r.id).toLowerCase().startsWith(ID_PREFIX)
      );
    }
  }
  return rows[0];
}

async function main() {
  console.log("==> Auditoria fluxo cliente");
  console.log("    marker: vps-audit-fluxo-cliente-v1");
  console.log("    NAME:", NAME || "-");
  console.log("    ID_PREFIX:", ID_PREFIX || "-");

  const p = await resolveUser();
  const uid = p.id;
  console.log("\n==> Perfil");
  console.log("    id:", uid);
  console.log("    nome:", p.full_name);
  console.log("    pix:", p.pix_key ? "(cadastrada)" : "(ausente)");

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const demo = n(p.demo_balance_cents);
  const desafio = n(p.desafio_balance_cents);
  const provedor =
    n(p.investor_balance_cents) + n(p.demo_balance_provider_cents);
  const congelado = n(p.locked_balance_cents);
  const apostador = real + reembolso + demo;

  console.log("\n==> Carteiras AGORA");
  console.log("    Apostador :", money(apostador));
  console.log("    Real      :", money(real));
  console.log("    Reembolso :", money(reembolso));
  console.log("    Desafio   :", money(desafio));
  console.log("    Provedor  :", money(provedor));
  console.log("    Congelado :", money(congelado));

  const manuals = await sbTry(
    [
      `/rest/v1/manual_deposits?select=id,amount_cents,status,network,deposit_type,admin_notes,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=200`,
    ],
    { optional: true }
  );
  const asaas = await sbTry(
    [
      `/rest/v1/asaas_payments?select=id,amount_cents,confirmed_amount_cents,status,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=100`,
    ],
    { optional: true }
  );
  let depApproved = 0;
  console.log("\n==> Depósitos");
  for (const d of Array.isArray(manuals) ? manuals : []) {
    const st = String(d.status || "").toLowerCase();
    const ok = ["approved", "confirmed", "paid", "completed", "aprovado"].includes(st);
    if (ok) depApproved += n(d.amount_cents);
    console.log(
      `    ${d.created_at} ${String(d.status).padEnd(12)} ${money(d.amount_cents)}`
    );
  }
  for (const d of Array.isArray(asaas) ? asaas : []) {
    const st = String(d.status || "").toLowerCase();
    const ok = ["confirmed", "received", "paid", "approved", "completed"].includes(st);
    const amt = n(d.confirmed_amount_cents || d.amount_cents);
    if (ok) depApproved += amt;
    console.log(`    asaas ${d.created_at} ${String(d.status).padEnd(12)} ${money(amt)}`);
  }
  console.log("    soma aprovada:", money(depApproved));

  const wds = await sbTry(
    [
      `/rest/v1/withdrawals?select=id,amount_cents,status,pix_key,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=30`,
    ],
    { optional: true }
  );
  console.log("\n==> Saques (", (Array.isArray(wds) ? wds : []).length, ")");
  for (const w of Array.isArray(wds) ? wds : []) {
    const meta = metaOf(w);
    console.log(
      `    ${w.created_at} ${String(w.status).padEnd(12)} ${money(w.amount_cents)} origin=${meta.origin || meta.label || "-"}`
    );
  }

  const prots = await sbTry([
    `/rest/v1/protections?select=id,status,side,odd,amount_cents,responsibility_cents,platform_deduction_cents,locked_deduction_cents,settled_outcome,settled_at,created_at,metadata,match_id&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=200`,
  ]);
  const protections = Array.isArray(prots) ? prots : [];

  const txs = await sbTry([
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=800`,
  ]);
  const allTx = Array.isArray(txs) ? txs : [];

  const issues = [];
  let expectedReembolsoFromArbi = 0;
  let indevidoExchangeCredit = 0;
  let missingFees = 0;
  let feesCharged = 0;

  console.log("\n==> Proteções (", protections.length, ")");
  for (const row of protections) {
    const meta = metaOf(row);
    const stake = n(row.responsibility_cents || row.amount_cents);
    const out = outcomeOf(row);
    const feeUp = isFeeUpfront(row);
    const expFee = expectedFeeCents(row);
    const expSettle = isSettled(row) ? expectedSettleCredit(row) : 0;

    const feeTxs = allTx.filter(
      (t) =>
        String(t.type) === "protection_fee" &&
        (String(t.ref) === String(row.id) ||
          String(metaOf(t).protection_id || "") === String(row.id))
    );
    const feeCharged = feeTxs.reduce((s, t) => s + Math.abs(n(t.amount_cents)), 0);
    feesCharged += feeCharged;

    const settleTxs = allTx.filter(
      (t) =>
        String(t.type) === "protection_settlement" &&
        (String(t.ref) === String(row.id) ||
          String(metaOf(t).protection_id || "") === String(row.id))
    );
    const settleActual = settleTxs.reduce((s, t) => s + n(t.amount_cents), 0);

    console.log("\n    —", String(row.id).slice(0, 8) + "…", meta.home_team || "", "×", meta.away_team || "");
    console.log("      criada:", row.created_at, "| settled:", row.settled_at || "-");
    console.log("      status:", row.status, "| outcome:", out || "(ativo)");
    console.log("      stake:", money(stake), "| odd:", row.odd || meta.market_odd || "-");
    console.log("      fee_upfront:", feeUp ? "SIM" : "NÃO", "| billing:", meta.billing_model || "-");
    console.log("      fee esperada:", money(expFee), "| fee cobrada:", money(feeCharged));
    console.log("      settle esperado:", money(expSettle), "| settle ledger:", money(settleActual));

    if (feeUp && feeCharged === 0 && expFee > 0) {
      const msg = `SEM protection_fee (deveria ${money(expFee)})`;
      console.log("      !!", msg);
      issues.push({ type: "missing_fee", id: row.id, cents: expFee, msg });
      missingFees += expFee;
    }

    if (isSettled(row) && out === "exchange") {
      const uiRefund = feeUp ? 0 : Math.max(0, stake - Math.min(expFee, stake));
      if (feeUp && settleActual > 0) {
        const msg = `PERDEU fee_upfront mas settle creditou ${money(settleActual)}`;
        console.log("      !!", msg);
        issues.push({ type: "exchange_credit_indevido", id: row.id, cents: settleActual, msg });
        indevidoExchangeCredit += settleActual;
      } else if (!feeUp && settleActual > uiRefund + 1) {
        const msg = `settle legado ${money(settleActual)} > esperado UI ${money(uiRefund)}`;
        console.log("      !!", msg);
        issues.push({ type: "settle_legado_alto", id: row.id, cents: settleActual - uiRefund, msg });
      }
    }

    if (isSettled(row) && out === "arbishield") {
      const exp = feeUp ? stake + expFee : stake;
      expectedReembolsoFromArbi += exp;
      if (settleActual < exp - 1) {
        const msg = `GANHOU Arbi mas settle só ${money(settleActual)} (esperado ${money(exp)})`;
        console.log("      !!", msg);
        issues.push({ type: "arbi_credit_faltando", id: row.id, cents: exp - settleActual, msg });
      }
    }

    if (isSettled(row) && out === "exchange" && feeUp && settleActual === 0 && feeCharged === 0) {
      console.log("      ✓ PERDEU correto (sem fee e sem settle — verificar se fee deveria ter sido cobrada)");
    }
  }

  console.log("\n==> Ledger resumo");
  let sumDep = 0,
    sumFee = 0,
    sumSettle = 0,
    sumAdmin = 0,
    sumWd = 0;
  const reembSettles = [];
  for (const t of allTx) {
    const type = String(t.type || "");
    const amt = n(t.amount_cents);
    if (type.includes("deposit") || type === "manual_deposit") sumDep += amt;
    else if (type === "protection_fee") sumFee += amt;
    else if (type === "protection_settlement") {
      sumSettle += amt;
      if (amt > 0) reembSettles.push(t);
    } else if (type === "admin_adjustment") sumAdmin += amt;
    else if (type.includes("withdraw")) sumWd += amt;
  }
  console.log("    depósitos     :", money(sumDep));
  console.log("    protection_fee:", money(sumFee));
  console.log("    settlements + :", money(reembSettles.reduce((s, t) => s + n(t.amount_cents), 0)));
  console.log("    admin         :", money(sumAdmin));
  console.log("    saques/out    :", money(sumWd));

  console.log("\n==> Origem Saldo Reembolso (", money(reembolso), ")");
  for (const t of reembSettles) {
    const m = metaOf(t);
    console.log(
      `    ${t.created_at} +${money(t.amount_cents)} outcome=${m.outcome || "-"} billing=${m.billing_model || "-"} ref=${String(t.ref).slice(0, 8)}`
    );
  }
  if (expectedReembolsoFromArbi > 0) {
    console.log(
      "    soma Arbi esperada (settles):",
      money(expectedReembolsoFromArbi),
      Math.abs(expectedReembolsoFromArbi - reembolso) <= 100
        ? "≈ bate Reembolso atual"
        : `≠ Reembolso ${money(reembolso)}`
    );
  }
  if (indevidoExchangeCredit > 0) {
    console.log("    créditos Exchange indevidos:", money(indevidoExchangeCredit));
  }

  console.log("\n==> DIAGNÓSTICO (", issues.length, " achados)");
  if (!issues.length) {
    console.log("    Nenhuma inconsistência óbvia nas proteções settled.");
    console.log("    Reembolso pode ser legítimo (vitórias Arbi) ou ajustes admin.");
  } else {
    for (const i of issues) {
      console.log(`    [${i.type}] ${String(i.id).slice(0, 8)}… ${i.msg}`);
    }
  }

  // Teórico fee_upfront: depósitos + fees + admin + settles legítimos Arbi - saques
  const legitSettle = expectedReembolsoFromArbi;
  const theoreticalApostador =
    depApproved + sumFee + sumAdmin + legitSettle + sumWd;
  console.log("\n==> Contas (fee_upfront, só Real+Reembolso+demo)");
  console.log("    depósitos aprovados :", money(depApproved));
  console.log("    + fees (ledger)     :", money(sumFee));
  console.log("    + admin             :", money(sumAdmin));
  console.log("    + settles Arbi esp. :", money(legitSettle));
  console.log("    + saques/outros     :", money(sumWd));
  console.log("    = teórico Apostador :", money(theoreticalApostador));
  console.log("    Apostador atual     :", money(apostador));
  console.log(
    "    delta               :",
    money(apostador - theoreticalApostador),
    apostador > theoreticalApostador + 50
      ? "← cliente com saldo ACIMA do teórico (crédito indevido?)"
      : apostador < theoreticalApostador - 50
        ? "← cliente com saldo ABAIXO (fee não cobrada / clawback?)"
        : ""
  );

  if (reembolso > 0 && indevidoExchangeCredit > 0) {
    console.log("\n==> Correção sugerida");
    console.log(
      "    Mover ou estornar",
      money(Math.min(reembolso, indevidoExchangeCredit)),
      "do Reembolso (créditos Exchange PERDEU indevidos)"
    );
    console.log(
      "    Se faltou fee, cobrar",
      money(missingFees),
      "no Real (protection_fee retroativa)"
    );
  } else if (missingFees > 0) {
    console.log("\n==> Correção sugerida: cobrar fees faltantes", money(missingFees));
  } else if (
    reembolso > 0 &&
    expectedReembolsoFromArbi > 0 &&
    Math.abs(reembolso - expectedReembolsoFromArbi) <= 100
  ) {
    console.log("\n==> Reembolso parece legítimo (vitórias ArbiShield)");
  }

  console.log("\n(fim auditoria — sem FIX automático; use scripts de correção caso a caso)");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
