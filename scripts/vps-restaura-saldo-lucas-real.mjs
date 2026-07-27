#!/usr/bin/env node
/**
 * Restaura saldo Real do Lucas após clawback indevido.
 *
 * Situação (após auditoria v2):
 *   - Depósito R$ 300 + fee -R$ 0,65 + admin +R$ 1 → teórico R$ 300,35
 *   - Settle Exchange legacy_lock creditou +R$ 149 no Reembolso (indevido)
 *   - Clawback/outros removeu R$ 149 do Reembolso SEM devolver ao Real
 *   - Apostador ficou R$ 150,35 (faltam R$ 150 vs teórico)
 *
 * Correção: creditar o buraco no Saldo Real.
 *
 * Relatório:
 *   node scripts/vps-restaura-saldo-lucas-real.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-restaura-saldo-lucas-real.mjs
 *
 * Marker: vps-restaura-saldo-lucas-real-v1
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
// Default: fecha o buraco até o teórico fee_upfront (300.35 - 150.35 = 150)
const AMOUNT_CENTS = Math.round(Number(process.env.AMOUNT_CENTS || 15000));

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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  return data;
}

async function main() {
  console.log("==> Restaura Saldo Real — Lucas");
  console.log("    marker: vps-restaura-saldo-lucas-real-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    crédito proposto:", money(AMOUNT_CENTS));

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(USER_ID)}`
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
  console.log("    nome:", p.full_name);
  console.log("    Real:", money(real));
  console.log("    Reembolso:", money(reembolso));
  console.log("    Desafio:", money(p.desafio_balance_cents));
  console.log("    Apostador:", money(apostador));

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.desc&limit=80`
  );
  const allTx = Array.isArray(txs) ? txs : [];

  console.log("\n==> Últimos movimentos (80)");
  for (const t of allTx) {
    const m = metaOf(t);
    console.log(
      `    ${t.created_at} ${String(t.type).padEnd(22)} ${money(t.amount_cents).padStart(12)} kind=${m.kind || m.reason || m.note || m.outcome || "-"} ref=${String(t.ref || "-").slice(0, 8)}`
    );
  }

  const already = allTx.find((t) => {
    const m = metaOf(t);
    return (
      m.kind === "restore_lucas_real_after_bad_clawback" ||
      (m.kind === "fix_lucas_reembolso_to_real" && n(t.amount_cents) > 0)
    );
  });
  if (already) {
    console.log("\n==> Já restaurado:", already.id, already.created_at);
    console.log("    nada a fazer.");
    return;
  }

  // Detecta clawback que zerou reembolso sem devolver ao real
  const claw = allTx.filter((t) => {
    const m = metaOf(t);
    return (
      m.kind === "clawback_exchange_reembolso_lucas" ||
      (String(t.type) === "admin_adjustment" &&
        n(t.amount_cents) < 0 &&
        String(m.bucket || "").includes("deduction"))
    );
  });
  console.log("\n==> Clawbacks detectados:", claw.length);
  for (const t of claw) {
    console.log("   ", t.created_at, money(t.amount_cents), metaOf(t).kind || metaOf(t).reason);
  }

  const theoretical = 30035; // 300 - 0.65 + 1.00 (da auditoria)
  const gap = Math.max(0, theoretical - apostador);
  const credit = AMOUNT_CENTS > 0 ? AMOUNT_CENTS : gap;

  console.log("\n==> Contas");
  console.log("    teórico fee_upfront:", money(theoretical));
  console.log("    apostador agora    :", money(apostador));
  console.log("    buraco             :", money(gap));
  console.log("    vai creditar Real  :", money(credit));
  console.log("    Real depois        :", money(real + credit));
  console.log("    Apostador depois   :", money(apostador + credit));

  if (credit <= 0) {
    console.log("\nNada a creditar.");
    return;
  }
  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para aplicar.");
    return;
  }

  const newBal = n(p.balance_cents) + credit;
  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: newBal,
      updated_at: new Date().toISOString(),
    },
  });

  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: credit,
      ref: "5b8b1c36-e7e5-4fcf-96ce-537fee35b3f7",
      metadata: {
        kind: "restore_lucas_real_after_bad_clawback",
        bucket: "balance_cents",
        label: "Saldo Real",
        reason:
          "Restaura Real: settle Exchange creditou Reembolso e clawback removeu sem devolver (depósito R$ 300 / 2 ops PERDEU)",
        name: NAME,
        theoretical_cents: theoretical,
        gap_before_cents: gap,
      },
    },
  });

  console.log("\n==> FIX OK");
  console.log("    Real:", money(real), "→", money(newBal));
  console.log("    Apostador:", money(apostador), "→", money(apostador + credit));
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
