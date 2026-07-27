#!/usr/bin/env node
/**
 * Cobra dedução ArbiShield faltante — Lucas (proteção Crvena R$ 149).
 *
 * Proteção PERDEU na Exchange; fee_upfront deveria ter debitado R$ 5,52
 * na ativação (LAY R$ 149, odd 20,20) mas protection_fee não foi gravado.
 *
 * Relatório:
 *   node scripts/vps-cobra-fee-crvena-lucas.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-cobra-fee-crvena-lucas.mjs
 *
 * Marker: vps-cobra-fee-crvena-lucas-v1
 */
import fs from "node:fs";
import path from "node:path";
import { calcLay } from "./lib/protection-flow-contract.mjs";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const USER_ID = String(
  process.env.USER_ID || "1210f201-1227-48c7-8336-334942dca7d6"
).trim();
const NAME = String(
  process.env.NAME || "Lucas Gonçalves dos Santos"
).trim();
const PROT_ID = String(
  process.env.PROT_ID || "5b8b1c36-e7e5-4fcf-96ce-537fee35b3f7"
).trim();
const LAY_ODD = Number(process.env.LAY_ODD || 20.2);
const STAKE_CENTS = Math.round(Number(process.env.STAKE_CENTS || 14900));
const FEE_CENTS = Math.round(
  Number(
    process.env.FEE_CENTS ||
      calcLay(STAKE_CENTS, LAY_ODD).arbiShieldDeductionCents
  )
);
const TARGET_APOSTADOR_CENTS = Math.round(
  Number(process.env.TARGET_APOSTADOR_CENTS || 29483)
); // 300 - 0.65 - 5.52 + 1 admin

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
if (!(FEE_CENTS > 0)) {
  console.error("ERRO: FEE_CENTS inválido");
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 320)}`);
  return data;
}

async function main() {
  console.log("==> Cobrar fee faltante Crvena — Lucas");
  console.log("    marker: vps-cobra-fee-crvena-lucas-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    proteção:", PROT_ID);
  console.log("    LAY R$", (STAKE_CENTS / 100).toFixed(2), "odd", LAY_ODD);
  console.log("    fee a cobrar:", money(FEE_CENTS));
  console.log("    alvo Apostador:", money(TARGET_APOSTADOR_CENTS));

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents&id=eq.${encodeURIComponent(USER_ID)}`
  );
  const p = Array.isArray(profiles) && profiles[0];
  if (!p) {
    console.error("ERRO: perfil não encontrado");
    process.exit(2);
  }

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const apostador = real + reembolso + n(p.demo_balance_cents);

  console.log("\n==> Antes");
  console.log("    Real     :", money(real));
  console.log("    Reembolso:", money(reembolso));
  console.log("    Apostador:", money(apostador));

  const protRows = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,platform_deduction_cents,settled_outcome,metadata&user_id=eq.${encodeURIComponent(USER_ID)}&id=eq.${encodeURIComponent(PROT_ID)}`
  );
  const prot = Array.isArray(protRows) && protRows[0];
  if (prot) {
    console.log("\n==> Proteção Crvena");
    console.log("    status:", prot.status);
    console.log("    outcome:", prot.settled_outcome);
    console.log("    platform_deduction_cents:", money(prot.platform_deduction_cents));
  }

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.desc&limit=200`
  );
  const allTx = Array.isArray(txs) ? txs : [];

  const existingFee = allTx.filter(
    (t) =>
      String(t.type) === "protection_fee" &&
      (String(t.ref) === PROT_ID ||
        String(metaOf(t).protection_id || "") === PROT_ID)
  );
  const existingRetro = allTx.filter((t) => {
    const m = metaOf(t);
    return (
      m.kind === "retroactive_protection_fee_crvena_lucas" ||
      (m.kind === "cobra_fee_crvena_lucas_v1" && String(t.ref) === PROT_ID)
    );
  });

  console.log("\n==> Cobranças existentes nesta proteção");
  console.log("    protection_fee:", existingFee.length);
  existingFee.forEach((t) =>
    console.log("      ", t.created_at, money(t.amount_cents))
  );
  console.log("    cobrança retroativa:", existingRetro.length);
  existingRetro.forEach((t) =>
    console.log("      ", t.created_at, money(t.amount_cents), metaOf(t).kind)
  );

  if (existingFee.length || existingRetro.length) {
    console.log("\n✓ Fee Crvena já registrada/cobrada. Nada a fazer.");
    return;
  }

  const newBal = n(p.balance_cents) - FEE_CENTS;
  if (newBal < 0) {
    console.error(
      "ERRO: saldo Real insuficiente para cobrar",
      money(FEE_CENTS),
      "(disponível",
      money(p.balance_cents) + ")"
    );
    process.exit(3);
  }

  const newApostador = apostador - FEE_CENTS;

  console.log("\n==> Plano");
  console.log("    debitar Real     :", money(FEE_CENTS));
  console.log("    balance_cents    :", money(p.balance_cents), "→", money(newBal));
  console.log("    Apostador depois :", money(newApostador));
  console.log(
    "    vs alvo",
    money(TARGET_APOSTADOR_CENTS),
    Math.abs(newApostador - TARGET_APOSTADOR_CENTS) <= 1
      ? "✓"
      : `(delta ${money(newApostador - TARGET_APOSTADOR_CENTS)})`
  );
  console.log("\n    Conta fechada:");
  console.log("      Depósito R$ 300,00");
  console.log("      − Cobreloa fee R$ 0,65");
  console.log("      − Crvena fee R$ 5,52");
  console.log("      + admin R$ 1,00");
  console.log("      = R$ 294,83");

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para aplicar.");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: newBal,
      updated_at: new Date().toISOString(),
    },
  });

  // Atualiza platform_deduction na proteção se estiver zerado
  if (prot && n(prot.platform_deduction_cents) < FEE_CENTS) {
    const meta = metaOf(prot);
    await sb(`/rest/v1/protections?id=eq.${encodeURIComponent(PROT_ID)}`, {
      method: "PATCH",
      body: {
        platform_deduction_cents: FEE_CENTS,
        metadata: {
          ...meta,
          fee_charged_cents: FEE_CENTS,
          fee_retroactive: true,
          billing_model: meta.billing_model || "fee_upfront_v1",
        },
        updated_at: new Date().toISOString(),
      },
    });
  }

  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "protection_fee",
      amount_cents: -FEE_CENTS,
      ref: PROT_ID,
      metadata: {
        kind: "cobra_fee_crvena_lucas_v1",
        protection_id: PROT_ID,
        label: "Dedução ArbiShield (retroativa)",
        reason:
          "Fee fee_upfront não cobrada na ativação — Crvena LAY R$149 odd 20.20 PERDEU Exchange",
        name: NAME,
        lay_odd: LAY_ODD,
        stake_cents: STAKE_CENTS,
        retroactive: true,
      },
    },
  });

  console.log("\n==> ✓ Fee cobrada");
  console.log("    Real     :", money(real), "→", money(newBal));
  console.log("    Apostador:", money(apostador), "→", money(newApostador));
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
