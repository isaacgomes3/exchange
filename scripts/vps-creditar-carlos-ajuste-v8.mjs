#!/usr/bin/env node
/**
 * Credita R$ 11,11 no Apostador do Carlos — ajuste da fórmula v8.
 *
 * Histórico: force-unfreeze cobrou fees antigos (91,11 + 5,00 = 96,11).
 * Fórmula vigente LAY 1000 @10: 80,50 + 4,50 = 85,00.
 * Diferença a devolver: 11,11.
 *
 * Tela atual esperada: Apostador R$ 8.971,41 · Congelado 0 · Reembolso 0
 * Após FIX: Apostador R$ 8.982,52
 *
 * Na VPS:
 *   node scripts/vps-creditar-carlos-ajuste-v8.mjs
 *   FIX=1 node scripts/vps-creditar-carlos-ajuste-v8.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const EXPECT_BALANCE = Math.trunc(Number(process.env.EXPECT_BALANCE_CENTS || 897_141));
const CREDIT = Math.trunc(Number(process.env.CREDIT_CENTS || 1_111)); // R$ 11,11
const TARGET = Math.trunc(Number(process.env.TARGET_BALANCE_CENTS || EXPECT_BALANCE + CREDIT)); // 898252
const TAG = "ajuste-fees-v8-carlos-1111";

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

async function sb(p, { method = "GET", body, headers } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "return=representation" : "return=representation",
      ...(headers || {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
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
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents&limit=1`
    );
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) throw new Error(`USER_ID não encontrado: ${USER_ID_ENV}`);
    return p;
  }
  // profiles-sem-coluna-email-v1
  const byName = await sb(
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents&limit=20`
  );
  const list = Array.isArray(byName) ? byName : [];
  const hit =
    list.find((p) => n(p.balance_cents) === EXPECT_BALANCE) ||
    list.find((p) => n(p.balance_cents) === TARGET) ||
    list.find(
      (p) =>
        String(p.full_name || "").toLowerCase().includes("carlos") &&
        String(p.full_name || "").toLowerCase().includes("roberto")
    );
  if (!hit) {
    console.log("Candidatos:");
    for (const p of list.slice(0, 10)) {
      console.log(" ", p.id, p.full_name, money(p.balance_cents), "locked", money(p.locked_balance_cents));
    }
    throw new Error("Carlos não identificado — passe USER_ID=");
  }
  return hit;
}

async function alreadyDone(userId) {
  const rows = await sb(
    `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(userId)}&select=id,metadata,amount_cents,created_at&order=created_at.desc&limit=50`
  ).catch(() => []);
  for (const t of Array.isArray(rows) ? rows : []) {
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    if (meta.repair_tag === TAG || meta.tag === TAG) return t;
  }
  return null;
}

async function main() {
  console.log("==> Ajuste fees v8 Carlos", FIX ? "(FIX=1)" : "(dry-run)");
  console.log("    crédito:", money(CREDIT), "→ alvo", money(TARGET));

  const user = await findUser();
  console.log(
    "    user:",
    user.id,
    user.full_name,
    "Apostador",
    money(user.balance_cents),
    "Congelado",
    money(user.locked_balance_cents),
    "Reembolso",
    money(user.deduction_balance_cents)
  );

  if (n(user.locked_balance_cents) !== 0) {
    console.warn("AVISO: ainda há Congelado — rode antes o diag-descongelar.");
  }

  const prev = await alreadyDone(user.id);
  if (prev) {
    console.log("OK — ajuste já aplicado:", prev.id, prev.created_at);
    return;
  }

  if (n(user.balance_cents) === TARGET) {
    console.log("OK — saldo já no alvo v8", money(TARGET));
    return;
  }

  if (n(user.balance_cents) !== EXPECT_BALANCE) {
    console.warn(
      "AVISO: saldo atual",
      money(user.balance_cents),
      "≠ esperado",
      money(EXPECT_BALANCE),
      "— confira antes de FIX=1 (ou passe TARGET_BALANCE_CENTS / CREDIT_CENTS)"
    );
    if (!FIX) process.exit(2);
  }

  const nextBal = n(user.balance_cents) + CREDIT;
  console.log("PATCH balance:", money(user.balance_cents), "→", money(nextBal));

  if (!FIX) {
    console.log("Dry-run. Rode FIX=1 para aplicar.");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: { balance_cents: nextBal },
    headers: { Prefer: "return=minimal" },
  });

  try {
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: user.id,
        amount_cents: CREDIT,
        type: "credit",
        description: "Ajuste fórmula LAY v8 (1000@10 → 80,50+4,50 em vez de 91,11+5)",
        metadata: {
          repair_tag: TAG,
          tag: TAG,
          old_fees_cents: 9611,
          new_fees_cents: 8500,
          credit_cents: CREDIT,
        },
      },
    });
  } catch (e) {
    console.warn("  wallet_transactions skip:", e.message || e);
  }

  const after = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents&limit=1`
  );
  const p = Array.isArray(after) ? after[0] : null;
  console.log("VERIFY:");
  console.log("  Apostador", money(p?.balance_cents), "(alvo", money(TARGET) + ")");
  console.log("  Congelado", money(p?.locked_balance_cents));
  console.log("  Reembolso", money(p?.deduction_balance_cents), "(Exchange → R$ 0 OK)");
  if (n(p?.balance_cents) !== TARGET) {
    console.error("FALHA: saldo não bateu o alvo");
    process.exit(1);
  }
  console.log("OK — hard refresh no Financeiro.");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
