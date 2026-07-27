#!/usr/bin/env node
/**
 * ⛔ SUPERSEDED — NÃO use alvo fixo R$ 8.976,41 sem odd do bilhete.
 * Sport×Cuiabá (odd 32) → R$ 9.051,71 via vps-force-carlos-905171.
 * Override: ALLOW_ODD10_TARGET=1
 */
import fs from "node:fs";
import path from "node:path";

if (process.env.ALLOW_ODD10_TARGET !== "1") {
  console.error("⛔ BLOQUEADO: vps-ajustar-carlos-897641 supersedido.");
  console.error("   Use: FIX=1 node scripts/vps-force-carlos-905171.mjs");
  process.exit(2);
}

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const TARGET = Math.trunc(Number(process.env.TARGET_BALANCE_CENTS || 897_641));
const TAG = "ajuste-carlos-897641-v9";

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
  const byName = await sb(
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents&limit=20`
  );
  const list = Array.isArray(byName) ? byName : [];
  const preferred = [897_641, 898_252, 897_141, 806_752];
  for (const bal of preferred) {
    const hit = list.find((p) => n(p.balance_cents) === bal);
    if (hit) return hit;
  }
  const hit = list.find(
    (p) =>
      String(p.full_name || "").toLowerCase().includes("carlos") &&
      String(p.full_name || "").toLowerCase().includes("roberto")
  );
  if (!hit) {
    console.log("Candidatos:");
    for (const p of list.slice(0, 10)) {
      console.log(" ", p.id, p.full_name, money(p.balance_cents));
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
  console.log("==> Ajuste Carlos →", money(TARGET), FIX ? "(FIX=1)" : "(dry-run)");
  console.log("    regra: 8.067,52 + 1.000 − 91,11 = 8.976,41");

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
    console.warn("AVISO: ainda há Congelado.");
  }

  const prev = await alreadyDone(user.id);
  if (prev && n(user.balance_cents) === TARGET) {
    console.log("OK — já no alvo:", prev.id);
    return;
  }

  if (n(user.balance_cents) === TARGET) {
    console.log("OK — saldo já é", money(TARGET));
    return;
  }

  const delta = TARGET - n(user.balance_cents);
  console.log(
    "PATCH balance:",
    money(user.balance_cents),
    "→",
    money(TARGET),
    `(delta ${money(delta)})`
  );

  if (!FIX) {
    console.log("Dry-run. Rode FIX=1 para aplicar.");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: { balance_cents: TARGET },
    headers: { Prefer: "return=minimal" },
  });

  try {
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: user.id,
        amount_cents: delta,
        type: delta >= 0 ? "credit" : "debit",
        description:
          "Ajuste carteira v9: 8.067,52 + 1.000 − 91,11 = 8.976,41 (só dedução, sem comissão extra)",
        metadata: {
          repair_tag: TAG,
          tag: TAG,
          target_cents: TARGET,
          delta_cents: delta,
          formula: "8067.52+1000-91.11",
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
