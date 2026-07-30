#!/usr/bin/env node
/**
 * Correção TOTAL — Lucas Gonçalves dos Santos
 * Depósito R$ 300 + 2 proteções PERDEU (Exchange).
 *
 * Estado alvo (fee_upfront, sem crédito Exchange):
 *   Apostador = R$ 300,35 (depósito 300 − fee 0,65 + admin 1,00)
 *   Real      = R$ 300,35
 *   Reembolso = R$ 0
 *   Desafio   = R$ 0
 *
 * Relatório:
 *   node scripts/vps-correcao-total-lucas.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-correcao-total-lucas.mjs
 *
 * Marker: vps-correcao-total-lucas-v1
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
const TARGET_APOSTADOR_CENTS = Math.round(
  Number(process.env.TARGET_APOSTADOR_CENTS || 30035)
); // 300 - 0.65 + 1
const PROT_149 = String(
  process.env.PROT_149 || "5b8b1c36-e7e5-4fcf-96ce-537fee35b3f7"
).trim();

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
  console.log("==> Correção TOTAL — Lucas Gonçalves");
  console.log("    marker: vps-correcao-total-lucas-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    alvo Apostador:", money(TARGET_APOSTADOR_CENTS));

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,locked_balance_cents,investor_balance_cents&id=eq.${encodeURIComponent(USER_ID)}`
  );
  const p = Array.isArray(profiles) && profiles[0];
  if (!p) {
    console.error("ERRO: perfil não encontrado");
    process.exit(2);
  }

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const demo = n(p.demo_balance_cents);
  const desafio = n(p.desafio_balance_cents);
  const apostador = real + reembolso + demo;

  console.log("\n==> ANTES");
  console.log("    Real     :", money(real), `(balance=${money(p.balance_cents)} reusable=${money(p.reusable_balance_cents)})`);
  console.log("    Reembolso:", money(reembolso));
  console.log("    Demo     :", money(demo));
  console.log("    Desafio  :", money(desafio));
  console.log("    Apostador:", money(apostador));

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.asc&limit=500`
  );
  const allTx = Array.isArray(txs) ? txs : [];

  const already = allTx.filter((t) => {
    const m = metaOf(t);
    return m.kind === "correcao_total_lucas_v1";
  });
  if (already.length) {
    console.log("\n==> Correção total já aplicada:");
    already.forEach((t) =>
      console.log("   ", t.created_at, t.type, money(t.amount_cents), metaOf(t).note || "")
    );
    console.log("    abortando para não duplicar.");
    return;
  }

  // Resumo ledger
  let dep = 0,
    fees = 0,
    settle = 0,
    admin = 0;
  for (const t of allTx) {
    const amt = n(t.amount_cents);
    const type = String(t.type || "");
    if (type.includes("deposit") || type === "manual_deposit") dep += amt;
    else if (type === "protection_fee") fees += amt;
    else if (type === "protection_settlement") settle += amt;
    else if (type === "admin_adjustment") admin += amt;
  }

  console.log("\n==> Ledger (resumo)");
  console.log("    depósitos     :", money(dep));
  console.log("    protection_fee:", money(fees), "(Cobreloa R$ 0,65; Crvena R$ 149 sem fee)");
  console.log("    settlements   :", money(settle), "(+149 Exchange indevido)");
  console.log("    admin         :", money(admin));
  console.log("    NET           :", money(dep + fees + settle + admin));

  console.log("\n==> Comissão ArbiShield das 2 entradas");
  console.log("    Cobreloa R$ 20  : R$ 0,65 cobrada ✓");
  console.log("    Crvena R$ 149   : R$ 5,52 NÃO cobrada (bug ativação legado)");
  console.log("    Total cobrado   : R$ 0,65");
  console.log("    (não cobramos retroativo R$ 5,52 — falha do sistema)");

  // Plano: tudo no Real, zero Reembolso, Apostador = alvo
  const targetReal = TARGET_APOSTADOR_CENTS - demo;
  const targetReembolso = 0;
  const targetReusable = 0;
  const deltaApostador = TARGET_APOSTADOR_CENTS - apostador;

  console.log("\n==> PLANO");
  console.log("    balance_cents          :", money(p.balance_cents), "→", money(targetReal));
  console.log("    reusable_balance_cents :", money(p.reusable_balance_cents), "→", money(targetReusable));
  console.log("    deduction_balance_cents:", money(reembolso), "→", money(targetReembolso));
  console.log("    Apostador              :", money(apostador), "→", money(TARGET_APOSTADOR_CENTS));
  console.log("    ajuste líquido         :", money(deltaApostador));

  if (
    apostador === TARGET_APOSTADOR_CENTS &&
    reembolso === 0 &&
    n(p.reusable_balance_cents) === 0 &&
    n(p.balance_cents) === targetReal
  ) {
    console.log("\n✓ Saldo já está correto. Nada a fazer.");
    return;
  }

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para aplicar a correção total.");
    return;
  }

  const patched = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`,
    {
      method: "PATCH",
      body: {
        balance_cents: targetReal,
        reusable_balance_cents: targetReusable,
        deduction_balance_cents: targetReembolso,
        updated_at: new Date().toISOString(),
      },
    }
  );
  const row = Array.isArray(patched) ? patched[0] : patched;
  console.log("\n==> Profile PATCH OK");
  console.log("    Real     :", money(n(row.balance_cents) + n(row.reusable_balance_cents)));
  console.log("    Reembolso:", money(row.deduction_balance_cents));
  console.log(
    "    Apostador:",
    money(
      n(row.balance_cents) +
        n(row.reusable_balance_cents) +
        n(row.deduction_balance_cents) +
        n(row.demo_balance_cents)
    )
  );

  const note =
    "Correção total Lucas: dep R$300, 2x PERDEU, fee R$0,65, settle Exchange +149 revertido no bucket, Apostador=R$300,35 Real";

  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: deltaApostador,
      ref: PROT_149,
      metadata: {
        kind: "correcao_total_lucas_v1",
        bucket: "balance_cents",
        label: "Saldo Real",
        note,
        reason:
          "Correção total: restaurar Real após settle Exchange indevido e clawback; Reembolso zerado",
        name: NAME,
        before: {
          balance_cents: p.balance_cents,
          reusable_balance_cents: p.reusable_balance_cents,
          deduction_balance_cents: p.deduction_balance_cents,
          apostador_cents: apostador,
        },
        after: {
          balance_cents: targetReal,
          reusable_balance_cents: targetReusable,
          deduction_balance_cents: targetReembolso,
          apostador_cents: TARGET_APOSTADOR_CENTS,
        },
        fees_charged_cents: 65,
        fee_missing_crvena_cents: 552,
        settlement_indevido_cents: 14900,
      },
    },
  });

  if (reembolso > 0) {
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: p.id,
        type: "admin_adjustment",
        amount_cents: -reembolso,
        ref: "deduction_balance_cents",
        metadata: {
          kind: "correcao_total_lucas_v1",
          bucket: "deduction_balance_cents",
          label: "Saldo Reembolso",
          note: "Zerar Reembolso indevido (movido para Real)",
        },
      },
    });
  }

  console.log("\n==> ✓ CORREÇÃO TOTAL APLICADA");
  console.log("    Lucas deve ver:");
  console.log("      Apostador :", money(TARGET_APOSTADOR_CENTS));
  console.log("      Real      :", money(targetReal));
  console.log("      Reembolso : R$ 0,00");
  console.log("    Peça hard refresh em /app-carteira.html");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
