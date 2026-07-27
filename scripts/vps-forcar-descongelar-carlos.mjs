#!/usr/bin/env node
/**
 * FORÇA descongelar Carlos Roberto (print: Real 8.067,52 + Congelado 1.000).
 * Não depende de achar a proteção — usa o saldo atual como chave.
 *
 * Regra Exchange v7:
 *   devolve stake (locked) ao Apostador
 *   cobra dedução 91,11 + comissão 5,00 (LAY 1000 @10)
 *   zera locked
 *
 * Alvo: Apostador R$ 8.971,41 · Congelado R$ 0,00
 *
 * Na VPS:
 *   node scripts/vps-forcar-descongelar-carlos.mjs         # dry-run
 *   FIX=1 node scripts/vps-forcar-descongelar-carlos.mjs   # aplica
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com").trim().toLowerCase();
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();

// Print atual
const EXPECT_BALANCE = Math.trunc(Number(process.env.EXPECT_BALANCE_CENTS || 806_752));
const EXPECT_LOCKED = Math.trunc(Number(process.env.EXPECT_LOCKED_CENTS || 100_000));
// Fees LAY 1000 @10 (lucro 111,11 − 4,5% − 1,5%)
const FEE_CENTS = Math.trunc(Number(process.env.FEE_CENTS || 9_111));
const COMMISSION_CENTS = Math.trunc(Number(process.env.COMMISSION_CENTS || 500));
const TARGET_BALANCE = Math.trunc(
  Number(
    process.env.TARGET_BALANCE_CENTS ||
      EXPECT_BALANCE + EXPECT_LOCKED - FEE_CENTS - COMMISSION_CENTS
  )
); // 897141
const REPAIR_TAG = "force-unfreeze-carlos-exchange-v7";

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

function n(v) {
  return Math.max(0, Math.trunc(Number(v) || 0));
}
function money(c) {
  return (n(c) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 500)}`);
  return data;
}

async function findUser() {
  if (USER_ID_ENV) {
    const rows = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents&limit=1`
    );
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) throw new Error(`USER_ID não encontrado: ${USER_ID_ENV}`);
    return p;
  }
  // profiles.email não existe nesta base — busca por nome/saldo
  // 2) nome + saldo do print
  const rows = await sb(
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents&limit=30`
  );
  const list = Array.isArray(rows) ? rows : [];
  console.log("Candidatos:");
  for (const p of list.slice(0, 10)) {
    console.log(
      " ",
      p.id,
      p.full_name,
      "Real",
      money(p.balance_cents),
      "Locked",
      money(p.locked_balance_cents)
    );
  }
  const exact = list.find(
    (p) =>
      n(p.balance_cents) === EXPECT_BALANCE &&
      n(p.locked_balance_cents) === EXPECT_LOCKED
  );
  if (exact) return exact;
  const byLocked = list.find((p) => n(p.locked_balance_cents) === EXPECT_LOCKED);
  if (byLocked) return byLocked;
  // 3) qualquer perfil com esse par de saldos
  const byBal = await sb(
    `/rest/v1/profiles?balance_cents=eq.${EXPECT_BALANCE}&locked_balance_cents=eq.${EXPECT_LOCKED}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents&limit=5`
  );
  if (Array.isArray(byBal) && byBal[0]) return byBal[0];
  throw new Error(
    `Não achei perfil com Real=${money(EXPECT_BALANCE)} Locked=${money(EXPECT_LOCKED)}. Passe USER_ID=`
  );
}

async function alreadyApplied(userId) {
  const txs = await sb(
    `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(userId)}&select=id,type,amount_cents,metadata&order=created_at.desc&limit=50`
  );
  return (Array.isArray(txs) ? txs : []).some((t) => {
    const m = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    return m.repair_tag === REPAIR_TAG || m.fix === REPAIR_TAG;
  });
}

async function main() {
  console.log("==> FORÇAR descongelar Carlos", FIX ? "(FIX=1)" : "(dry-run)");
  console.log("    expect Real/Locked:", money(EXPECT_BALANCE), "/", money(EXPECT_LOCKED));
  console.log(
    "    fees:",
    money(FEE_CENTS),
    "+",
    money(COMMISSION_CENTS),
    "=",
    money(FEE_CENTS + COMMISSION_CENTS)
  );
  console.log("    target Real/Locked:", money(TARGET_BALANCE), "/", money(0));
  console.log("    tag:", REPAIR_TAG);

  const prof = await findUser();
  const bal = n(prof.balance_cents);
  const locked = n(prof.locked_balance_cents);
  console.log(
    "\n    user:",
    prof.id,
    "|",
    prof.full_name || "-",
    "\n    Real:",
    money(bal),
    "| Congelado:",
    money(locked),
    "| Reembolso:",
    money(prof.deduction_balance_cents)
  );

  if (locked <= 0 && bal === TARGET_BALANCE) {
    console.log("\nJá está no alvo (Congelado 0). Nada a fazer.");
    return;
  }
  if (locked <= 0) {
    console.log("\nCongelado já é 0, mas Real ≠ alvo:", money(bal), "≠", money(TARGET_BALANCE));
    console.log("Não mexo no Real automaticamente. Se precisar, rode com TARGET_BALANCE_CENTS=...");
    return;
  }

  // Aceita o print exato OU qualquer locked=1000 com real próximo
  let nextBal = TARGET_BALANCE;
  let nextLocked = 0;
  if (locked === EXPECT_LOCKED && Math.abs(bal - EXPECT_BALANCE) <= 2) {
    nextBal = bal + locked - FEE_CENTS - COMMISSION_CENTS;
    nextLocked = 0;
  } else if (locked === EXPECT_LOCKED) {
    // locked bate: devolve locked e cobra fees
    nextBal = bal + locked - FEE_CENTS - COMMISSION_CENTS;
    nextLocked = 0;
    console.log(
      "AVISO: Real atual",
      money(bal),
      "≠ print",
      money(EXPECT_BALANCE),
      "— aplico mesmo assim: +locked −fees"
    );
  } else {
    console.error(
      `\nERRO: Congelado atual ${money(locked)} ≠ esperado ${money(EXPECT_LOCKED)}.`
    );
    console.error(
      `Rode com EXPECT_LOCKED_CENTS=${locked} EXPECT_BALANCE_CENTS=${bal} se for o caso.`
    );
    process.exit(3);
  }

  if (nextBal < 0) {
    console.error("ERRO: saldo alvo negativo", nextBal);
    process.exit(4);
  }

  console.log(
    "\n    Plano: Real",
    money(bal),
    "→",
    money(nextBal),
    "| Congelado",
    money(locked),
    "→",
    money(nextLocked)
  );

  if (await alreadyApplied(prof.id)) {
    console.log("\nTag de reparo já existe. Forçando PATCH de saldo mesmo assim se locked>0…");
  }

  if (!FIX) {
    console.log("\nDry-run. Aplique com:");
    console.log("  FIX=1 node scripts/vps-forcar-descongelar-carlos.mjs");
    return;
  }

  const patched = await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(prof.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: nextBal,
      locked_balance_cents: nextLocked,
      reusable_balance_cents: 0,
      updated_at: new Date().toISOString(),
    },
  });
  const row = Array.isArray(patched) ? patched[0] : patched;
  if (!row || n(row.locked_balance_cents) !== 0) {
    // retry slim
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(prof.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        locked_balance_cents: 0,
      },
    });
  }

  // Auditoria
  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: prof.id,
      type: "protection_settlement",
      amount_cents: -(FEE_CENTS),
      ref: `force-unfreeze:${prof.id}`,
      metadata: {
        repair_tag: REPAIR_TAG,
        fix: REPAIR_TAG,
        outcome: "exchange",
        stake_cents: locked,
        fee_cents: FEE_CENTS,
        fee_charged_cents: FEE_CENTS,
        exchange_commission_cents: COMMISSION_CENTS,
        unlocked_locked: true,
        stake_returned: true,
        returned_stake_cents: locked,
        unlock_return_to_origin: true,
        balance_before_cents: bal,
        locked_before_cents: locked,
        balance_after_cents: nextBal,
        note: "FORCE unfreeze Carlos: devolve stake + cobra dedução Exchange v7",
      },
    },
  }).catch((e) => console.warn("tx settlement:", e.message || e));

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: prof.id,
      type: "exchange_commission",
      amount_cents: -(COMMISSION_CENTS),
      ref: `force-unfreeze:${prof.id}`,
      metadata: {
        repair_tag: REPAIR_TAG,
        fix: REPAIR_TAG,
        label: "Comissão Exchange (4,5% do lucro)",
        exchange_commission_cents: COMMISSION_CENTS,
        note: "FORCE unfreeze Carlos — comissão 4,5%",
      },
    },
  }).catch((e) => console.warn("tx commission:", e.message || e));

  const after = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(prof.id)}&select=balance_cents,locked_balance_cents,deduction_balance_cents&limit=1`
  );
  const p2 = Array.isArray(after) ? after[0] : null;
  console.log(
    "\nDepois: Real",
    money(p2?.balance_cents),
    "| Congelado",
    money(p2?.locked_balance_cents),
    "| Reembolso",
    money(p2?.deduction_balance_cents)
  );
  if (n(p2?.locked_balance_cents) > 0) {
    console.error("FALHOU: Congelado ainda > 0 após PATCH");
    process.exit(5);
  }
  console.log("OK — Congelado zerado (" + REPAIR_TAG + ")");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
