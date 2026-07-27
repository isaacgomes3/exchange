#!/usr/bin/env node
/**
 * Fluxo completo — Lucas Gonçalves dos Santos
 * Depósito ~R$ 300 + 2 proteções (PERDEU) — saldo atual incorreto.
 *
 * Relatório:
 *   node scripts/vps-fluxo-lucas-deposito-protecoes.mjs
 * Aplicar correção (Reembolso→Real do crédito Exchange indevido):
 *   FIX=1 node scripts/vps-fluxo-lucas-deposito-protecoes.mjs
 *
 * Marker: vps-fluxo-lucas-deposito-protecoes-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const USER_ID = String(
  process.env.USER_ID || "1210f201-1227-48c7-8336-334942dca7d6"
).trim();
const NAME = String(
  process.env.NAME || "Lucas Gonçalves dos Santos"
).trim();
const EXPECTED_DEPOSIT_CENTS = Math.round(
  Number(process.env.EXPECTED_DEPOSIT_CENTS || 30000)
);

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

async function sbTry(paths) {
  let last = null;
  for (const p of paths) {
    try {
      return await sb(p);
    } catch (e) {
      last = e;
    }
  }
  if (last) throw last;
  return null;
}

async function main() {
  console.log("==> Fluxo Lucas — depósito + 2 proteções");
  console.log("    marker: vps-fluxo-lucas-deposito-protecoes-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    user:", USER_ID, NAME);
  console.log("    depósito esperado:", money(EXPECTED_DEPOSIT_CENTS));

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key,created_at,updated_at&id=eq.${encodeURIComponent(USER_ID)}`
  );
  const p = Array.isArray(profiles) && profiles[0];
  if (!p) {
    console.error("ERRO: perfil não encontrado");
    process.exit(2);
  }

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const desafio = n(p.desafio_balance_cents);
  const apostador = real + reembolso + n(p.demo_balance_cents);
  const total =
    apostador +
    desafio +
    n(p.investor_balance_cents) +
    n(p.demo_balance_provider_cents) +
    n(p.locked_balance_cents);

  console.log("\n==> Carteiras AGORA");
  console.log("    Apostador :", money(apostador));
  console.log("    Real      :", money(real), `(balance=${money(p.balance_cents)} reusable=${money(p.reusable_balance_cents)})`);
  console.log("    Reembolso :", money(reembolso));
  console.log("    Desafio   :", money(desafio));
  console.log("    Congelado :", money(p.locked_balance_cents));
  console.log("    TOTAL     :", money(total));

  // --- Depósitos ---
  const manual = await sbTry([
    `/rest/v1/manual_deposits?select=id,amount_cents,status,network,deposit_type,admin_notes,created_at,updated_at&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=100`,
    `/rest/v1/manual_deposits?select=id,amount_cents,status,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=100`,
  ]);
  const asaas = await sbTry([
    `/rest/v1/asaas_payments?select=id,amount_cents,status,created_at,paid_at,net_value_cents&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=100`,
    `/rest/v1/asaas_deposits?select=id,amount_cents,status,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=100`,
  ]);
  const manuals = Array.isArray(manual) ? manual : [];
  const asaasRows = Array.isArray(asaas) ? asaas : [];

  console.log("\n==> Depósitos manuais (", manuals.length, ")");
  let depApproved = 0;
  for (const d of manuals) {
    const st = String(d.status || "").toLowerCase();
    const ok = ["approved", "confirmed", "paid", "completed", "aprovado"].includes(st);
    if (ok) depApproved += n(d.amount_cents);
    console.log(
      `    ${d.created_at} ${String(d.status).padEnd(12)} ${money(d.amount_cents)} ${d.deposit_type || d.network || ""} ${d.admin_notes || ""}`
    );
  }
  console.log("\n==> Depósitos Asaas/PIX (", asaasRows.length, ")");
  for (const d of asaasRows) {
    const st = String(d.status || "").toLowerCase();
    const ok = ["confirmed", "received", "paid", "approved", "completed"].includes(st);
    if (ok) depApproved += n(d.net_value_cents || d.amount_cents);
    console.log(
      `    ${d.created_at || d.paid_at} ${String(d.status).padEnd(12)} ${money(d.net_value_cents || d.amount_cents)}`
    );
  }
  console.log(
    "    soma aprovada:",
    money(depApproved),
    depApproved === EXPECTED_DEPOSIT_CENTS
      ? "✓ bate R$ 300"
      : `≠ esperado ${money(EXPECTED_DEPOSIT_CENTS)}`
  );

  // --- Proteções ---
  const prots = await sbTry([
    `/rest/v1/protections?select=id,status,side,odd,amount_cents,responsibility_cents,platform_deduction_cents,locked_deduction_cents,user_profit_cents,settled_outcome,settled_at,refunded_at,created_at,updated_at,metadata,match_id&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=50`,
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,settled_outcome,settled_at,created_at,metadata&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=50`,
  ]);
  const protections = Array.isArray(prots) ? prots : [];
  console.log("\n==> Proteções (", protections.length, ")");

  let feesChargedExpected = 0;
  let badExchangeCredits = 0;
  const badCreditProts = [];

  for (const row of protections) {
    const meta = metaOf(row);
    const stake = n(row.responsibility_cents || row.amount_cents);
    const fee = n(
      row.platform_deduction_cents != null
        ? row.platform_deduction_cents
        : row.locked_deduction_cents != null
          ? row.locked_deduction_cents
          : meta.fee_charged_cents
    );
    const out = outcomeOf(row);
    const feeUp = isFeeUpfront(row);
    console.log("\n    —", String(row.id).slice(0, 8) + "…");
    console.log("      criada   :", row.created_at);
    console.log("      settled  :", row.settled_at || "-");
    console.log("      status   :", row.status, "| outcome:", out || "-");
    console.log("      side/odd :", row.side || meta.side || "-", row.odd || meta.odd || "-");
    console.log("      stake    :", money(stake));
    console.log("      fee col  :", money(fee));
    console.log("      fee_upfront (contrato):", feeUp ? "SIM" : "NÃO");
    console.log("      billing_model:", meta.billing_model || "-");
    console.log("      source   :", meta.source || "-");
    console.log("      fee_upfront flag:", meta.fee_upfront);
    console.log("      balance_type:", meta.balance_type || meta.balanceType || "-");

    if (feeUp) feesChargedExpected += fee;

    // Regra produto fee_upfront: Exchange/PERDEU → crédito 0
    // Legado mal detectado: pode ter creditado stake no Reembolso
    if (out === "exchange") {
      if (feeUp) {
        console.log("      esperado settle: R$ 0 (fee_upfront + Exchange)");
      } else {
        const legado = Math.max(0, stake - Math.min(fee, stake));
        console.log(
          "      esperado settle legado:",
          money(legado),
          "→ Saldo Reembolso (BUG de produto se UI dizia fee_upfront)"
        );
        badExchangeCredits += legado;
        badCreditProts.push({ row, credit: legado, stake, fee });
      }
    } else if (out === "arbishield") {
      const credit = feeUp ? stake + fee : stake;
      console.log("      esperado settle Arbi:", money(credit), "→ Saldo Reembolso");
    }
  }

  // --- Ledger ---
  const txs = await sbTry([
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at,balance_after_cents&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=500`,
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=500`,
  ]);
  const allTx = Array.isArray(txs) ? txs : [];
  console.log("\n==> wallet_transactions cronológico (", allTx.length, ")");

  let net = 0;
  let sumFees = 0;
  let sumSettlements = 0;
  let sumDeposits = 0;
  let sumAdmin = 0;
  let sumOther = 0;
  const settlementCredits = [];

  for (const t of allTx) {
    const amt = n(t.amount_cents);
    net += amt;
    const m = metaOf(t);
    const type = String(t.type || "");
    const bucket = m.bucket || m.destination || m.origin || "";
    console.log(
      `    ${t.created_at} ${type.padEnd(22)} ${money(amt).padStart(12)} ref=${String(t.ref || "-").slice(0, 8)} bucket=${bucket || "-"} outcome=${m.outcome || "-"} note=${m.note || m.reason || m.kind || ""}`
    );

    if (type === "protection_fee") sumFees += amt;
    else if (type === "protection_settlement") {
      sumSettlements += amt;
      if (amt > 0) settlementCredits.push(t);
    } else if (
      type.includes("deposit") ||
      type === "manual_deposit" ||
      type === "asaas_deposit"
    )
      sumDeposits += amt;
    else if (type === "admin_adjustment") sumAdmin += amt;
    else sumOther += amt;
  }

  console.log("\n==> Totais do ledger");
  console.log("    deposits tx     :", money(sumDeposits));
  console.log("    protection_fee  :", money(sumFees), "(negativo = cobrado)");
  console.log("    settlements     :", money(sumSettlements));
  console.log("    admin_adjustment:", money(sumAdmin));
  console.log("    outros          :", money(sumOther));
  console.log("    NET ledger      :", money(net));

  // Fee rows per protection
  console.log("\n==> Cobrança protection_fee por proteção");
  for (const row of protections) {
    const feeTxs = allTx.filter(
      (t) =>
        String(t.type) === "protection_fee" &&
        (String(t.ref) === String(row.id) ||
          String(metaOf(t).protection_id || "") === String(row.id))
    );
    const sum = feeTxs.reduce((s, t) => s + n(t.amount_cents), 0);
    console.log(
      `    ${String(row.id).slice(0, 8)}… fees=${feeTxs.length} sum=${money(sum)} ${
        feeTxs.length ? "OK" : "NÃO ENCONTRADA ← UI Cobrança ausente"
      }`
    );
  }

  console.log("\n==> Settlements positivos (créditos)");
  for (const t of settlementCredits) {
    const m = metaOf(t);
    console.log(
      `    ${t.created_at} ${money(t.amount_cents)} outcome=${m.outcome || "-"} billing=${m.billing_model || "-"} ref=${t.ref}`
    );
  }

  // --- Esperado fee_upfront puro (as 2 ops PERDEU) ---
  // Apostador final ≈ depósitos_aprovados + admin + settlements_legítimos + fees
  // Com ambas Exchange em fee_upfront: settlements legítimos = 0, reembolso = 0
  const exchangeSettlementCredits = settlementCredits.filter((t) => {
    const m = metaOf(t);
    const o = String(m.outcome || "").toLowerCase();
    return o === "exchange" || o === "won_exchange" || o === "lost" || !o;
  });
  // Prefer explicit outcome=exchange; if missing outcome but amount matches PERDEU stake, count as bad
  let indevidoReembolso = 0;
  for (const t of settlementCredits) {
    const m = metaOf(t);
    const o = String(m.outcome || "").toLowerCase();
    const billing = String(m.billing_model || "");
    const amt = n(t.amount_cents);
    if (amt <= 0) continue;
    // crédito em settle com outcome exchange / billing legado / sem fee_upfront
    if (
      o === "exchange" ||
      o === "won_exchange" ||
      billing === "legacy_lock" ||
      billing === "lock_fee_after_v1" ||
      (o === "" && amt === 14900)
    ) {
      // Se fee_upfront_v1 com amount 0, não entra aqui
      if (billing === "fee_upfront_v1" && amt === 0) continue;
      if (billing === "fee_upfront_v1" && o === "exchange" && amt > 0) {
        indevidoReembolso += amt;
        continue;
      }
      // Legado exchange creditado no reembolso — à luz do produto atual (fee_upfront),
      // e do card PERDEU/R$0, tratamos como indevido quando a proteção não teve protection_fee
      const protId = String(t.ref || m.protection_id || "");
      const prot = protections.find((r) => String(r.id) === protId);
      const hadFee = allTx.some(
        (x) =>
          String(x.type) === "protection_fee" &&
          (String(x.ref) === protId ||
            String(metaOf(x).protection_id || "") === protId)
      );
      if (!hadFee || (prot && outcomeOf(prot) === "exchange")) {
        indevidoReembolso += amt;
      }
    }
  }

  console.log("\n==> Diagnóstico do saldo");
  console.log("    depósito aprovado     :", money(depApproved || EXPECTED_DEPOSIT_CENTS));
  console.log("    fees cobradas (ledger):", money(sumFees));
  console.log("    créditos settle       :", money(sumSettlements));
  console.log("    crédito indevido est. :", money(indevidoReembolso));
  console.log("    Reembolso atual       :", money(reembolso));
  console.log("    Real atual            :", money(real));
  console.log("    Apostador atual       :", money(apostador));

  // Correção preferencial:
  // O crédito Exchange foi para Reembolso, mas o dinheiro "sumiu" do Real
  // (stake liberado no bucket errado). Mover Reembolso → Real no valor do
  // crédito indevido (até o saldo de reembolso disponível).
  // Assim Apostador permanece; Real volta; Reembolso zera o indevido.
  const move = Math.min(reembolso, indevidoReembolso || reembolso);
  // Se indevido não detectado mas reembolso==149 e há settlement +149, move 149
  const fallbackMove =
    move > 0
      ? move
      : settlementCredits.some((t) => n(t.amount_cents) === 14900) && reembolso >= 14900
        ? 14900
        : 0;
  const toMove = move > 0 ? move : fallbackMove;

  const expectedReal = real + toMove;
  const expectedReembolso = reembolso - toMove;
  const expectedApostador = expectedReal + expectedReembolso + n(p.demo_balance_cents);

  console.log("\n==> Correção proposta (mover crédito Exchange do Reembolso → Real)");
  console.log("    mover                :", money(toMove));
  console.log("    Real depois          :", money(expectedReal));
  console.log("    Reembolso depois     :", money(expectedReembolso));
  console.log("    Apostador depois     :", money(expectedApostador), "(igual total útil)");

  // Esperado teórico fee_upfront se ambas PERDEU e fees cobrados:
  const theoretical =
    (depApproved || EXPECTED_DEPOSIT_CENTS) + sumFees + sumAdmin;
  // sumFees is negative; settlements indevidos excluded
  console.log(
    "\n    teórico fee_upfront (depósito + fees + admin, sem settle Exchange):",
    money(theoretical)
  );
  console.log(
    "    delta Apostador vs teórico:",
    money(apostador - theoretical)
  );

  if (toMove <= 0) {
    console.log("\nNada a mover automaticamente. Revise o ledger acima.");
    return;
  }

  // Já corrigido?
  const prior = allTx.filter((t) => {
    const m = metaOf(t);
    return (
      m.kind === "fix_lucas_reembolso_to_real" ||
      m.kind === "clawback_exchange_reembolso_lucas"
    );
  });
  if (prior.length) {
    console.log("\n==> Já existe ajuste anterior:");
    prior.forEach((t) =>
      console.log("   ", t.created_at, t.type, money(t.amount_cents), metaOf(t).kind)
    );
    console.log("    abortando FIX para não duplicar.");
    return;
  }

  if (!FIX) {
    console.log("\n(dry-run) Rode FIX=1 para aplicar a correção.");
    return;
  }

  const newReal = n(p.balance_cents) + toMove;
  const newDed = n(p.deduction_balance_cents) - toMove;
  if (newDed < 0) {
    console.error("ERRO: reembolso insuficiente");
    process.exit(3);
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: newReal,
      deduction_balance_cents: newDed,
      updated_at: new Date().toISOString(),
    },
  });

  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: 0, // movimento entre buckets; net zero
      ref: USER_ID,
      metadata: {
        kind: "fix_lucas_reembolso_to_real",
        from_bucket: "deduction_balance_cents",
        to_bucket: "balance_cents",
        amount_cents: toMove,
        reason:
          "Correção fluxo Lucas: settle Exchange/PERDEU creditou Saldo Reembolso; devolve ao Real (depósito R$ 300 + 2 ops)",
        name: NAME,
      },
    },
  });

  // Também registra linhas espelho para extrato legível
  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: -toMove,
      ref: "deduction_balance_cents",
      metadata: {
        kind: "fix_lucas_reembolso_to_real",
        bucket: "deduction_balance_cents",
        label: "Saldo Reembolso",
        note: "débito bucket reembolso (correção Exchange)",
      },
    },
  });
  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: toMove,
      ref: "balance_cents",
      metadata: {
        kind: "fix_lucas_reembolso_to_real",
        bucket: "balance_cents",
        label: "Saldo Real",
        note: "crédito bucket real (correção Exchange)",
      },
    },
  });

  console.log("\n==> FIX aplicado");
  console.log("    Real:", money(real), "→", money(newReal));
  console.log("    Reembolso:", money(reembolso), "→", money(newDed));
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
