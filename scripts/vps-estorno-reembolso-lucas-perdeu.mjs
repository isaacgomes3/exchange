#!/usr/bin/env node
/**
 * Estorna crédito indevido no Saldo Reembolso — Lucas (PERDEU / Exchange).
 *
 * Caso: proteção LAY R$ 149 (Crvena Zvezda) encerrada PERDEU / REEMBOLSO UI R$ 0,
 * mas settle legado creditou +R$ 149 em deduction_balance_cents.
 *
 * IMPORTANTE: NÃO apagar o valor. Mover Reembolso → Real (net zero).
 * Se o Reembolso já foi zerado por clawback antigo, use:
 *   scripts/vps-restaura-saldo-lucas-real.mjs
 *
 * Relatório:
 *   node scripts/vps-estorno-reembolso-lucas-perdeu.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-estorno-reembolso-lucas-perdeu.mjs
 *
 * Marker: vps-estorno-reembolso-lucas-perdeu-v2
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(
  process.env.NAME || "Lucas Gonçalves dos Santos"
).trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "1210f201")
  .trim()
  .toLowerCase();
const USER_ID = String(
  process.env.USER_ID || "1210f201-1227-48c7-8336-334942dca7d6"
).trim();
const AMOUNT_CENTS = Math.round(Number(process.env.AMOUNT_CENTS || 14900));
const PROT_PREFIX = String(process.env.PROT_PREFIX || "5b8b1c36")
  .trim()
  .toLowerCase();
const REASON = String(
  process.env.REASON ||
    "estorno: settle Exchange/PERDEU creditou Saldo Reembolso indevidamente (UI reembolso R$ 0)"
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
  console.log("==> Estorno Saldo Reembolso — Lucas PERDEU (mover → Real)");
  console.log("    marker: vps-estorno-reembolso-lucas-perdeu-v2");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    valor:", money(AMOUNT_CENTS));

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,deduction_balance_cents,desafio_balance_cents,reusable_balance_cents&id=eq.${encodeURIComponent(USER_ID)}`
  );
  const p = Array.isArray(profiles) && profiles[0];
  if (!p) {
    console.error("ERRO: perfil não encontrado", USER_ID);
    process.exit(2);
  }
  console.log("\n==> Perfil", p.id, p.full_name);
  console.log("    Real:", money(p.balance_cents));
  console.log("    Reembolso:", money(p.deduction_balance_cents));

  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,settled_outcome,settled_at,metadata,platform_deduction_cents,locked_deduction_cents&user_id=eq.${encodeURIComponent(USER_ID)}&order=created_at.desc&limit=20`
  );
  const list = Array.isArray(prots) ? prots : [];
  const target =
    list.find((r) => String(r.id).toLowerCase().startsWith(PROT_PREFIX)) ||
    list.find((r) => n(r.responsibility_cents || r.amount_cents) === AMOUNT_CENTS);

  if (target) {
    const meta =
      target.metadata && typeof target.metadata === "object"
        ? target.metadata
        : {};
    console.log("\n==> Proteção alvo");
    console.log("    id:", target.id);
    console.log("    status:", target.status);
    console.log("    settled_outcome:", target.settled_outcome);
    console.log("    stake:", money(target.responsibility_cents || target.amount_cents));
    console.log("    billing_model:", meta.billing_model || "-");
    console.log("    fee_upfront:", meta.fee_upfront);
    console.log("    source:", meta.source || "-");
    console.log(
      "    lock_fee_after:",
      meta.lock_fee_after || meta.billing_model === "lock_fee_after_v1"
    );
  } else {
    console.log("\n!! proteção prefix", PROT_PREFIX, "não encontrada — seguindo só pelo valor");
  }

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&type=eq.protection_settlement&order=created_at.desc&limit=20`
  );
  const settlements = Array.isArray(txs) ? txs : [];
  const creditTx = settlements.find((t) => {
    if (n(t.amount_cents) !== AMOUNT_CENTS) return false;
    if (target && String(t.ref) === String(target.id)) return true;
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    return String(meta.protection_id || "").startsWith(PROT_PREFIX);
  });
  console.log("\n==> protection_settlement +", money(AMOUNT_CENTS));
  if (creditTx) {
    console.log("    tx:", creditTx.id, creditTx.created_at);
    console.log("    ref:", creditTx.ref);
    console.log("    meta:", JSON.stringify(creditTx.metadata || {}));
  } else {
    console.log("    !! tx de crédito não encontrada pelo filtro — confira manualmente");
  }

  // já estornado?
  const clawbacks = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,created_at&user_id=eq.${encodeURIComponent(USER_ID)}&type=eq.admin_adjustment&order=created_at.desc&limit=30`
  );
  const already = (Array.isArray(clawbacks) ? clawbacks : []).find((t) => {
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    return (
      meta.kind === "fix_lucas_reembolso_to_real" ||
      (n(t.amount_cents) === -AMOUNT_CENTS &&
        String(meta.reason || "").includes("estorno") &&
        String(meta.protection_id || "").startsWith(PROT_PREFIX))
    );
  });
  if (already) {
    console.log("\n==> Já estornado:", already.id, already.created_at);
    console.log("    nada a fazer.");
    return;
  }

  const beforeDed = n(p.deduction_balance_cents);
  const beforeReal = n(p.balance_cents);
  if (beforeDed < AMOUNT_CENTS) {
    console.error(
      "ERRO: Saldo Reembolso insuficiente para mover",
      money(beforeDed),
      "<",
      money(AMOUNT_CENTS),
      "\nSe já zerou com clawback antigo, rode vps-restaura-saldo-lucas-real.sh"
    );
    process.exit(3);
  }
  const afterDed = beforeDed - AMOUNT_CENTS;
  const afterReal = beforeReal + AMOUNT_CENTS;
  console.log("\n==> Plano (MOVER, não apagar)");
  console.log("    Reembolso:", money(beforeDed), "→", money(afterDed));
  console.log("    Real     :", money(beforeReal), "→", money(afterReal));
  console.log("    razão:", REASON);

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para aplicar.");
    return;
  }

  const patched = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`,
    {
      method: "PATCH",
      body: {
        deduction_balance_cents: afterDed,
        balance_cents: afterReal,
        updated_at: new Date().toISOString(),
      },
    }
  );
  console.log(
    "    profile patch OK ded=",
    Array.isArray(patched) ? patched[0]?.deduction_balance_cents : "?",
    "real=",
    Array.isArray(patched) ? patched[0]?.balance_cents : "?"
  );

  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: 0,
      ref: target ? String(target.id) : PROT_PREFIX,
      metadata: {
        kind: "fix_lucas_reembolso_to_real",
        from_bucket: "deduction_balance_cents",
        to_bucket: "balance_cents",
        amount_cents: AMOUNT_CENTS,
        reason: REASON,
        protection_id: target ? target.id : null,
        name: NAME,
        id_prefix: ID_PREFIX,
        settlement_tx_id: creditTx ? creditTx.id : null,
      },
    },
  });
  console.log("    wallet_transactions OK");
  console.log("\n==> Feito. Real", money(afterReal), "| Reembolso", money(afterDed));
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
