#!/usr/bin/env node
/**
 * Crédito manual e idempotente no Saldo Apostador.
 *
 * Simular:
 *   EMAIL=isaacgomes3@gmail.com AMOUNT_CENTS=1000000 REQUEST_ID=credito-isaac-20260728 \
 *     node /opt/arbishield/scripts/vps-creditar-saldo-apostador.mjs
 * Aplicar:
 *   APPLY=1 EMAIL=isaacgomes3@gmail.com AMOUNT_CENTS=1000000 REQUEST_ID=credito-isaac-20260728 \
 *     node /opt/arbishield/scripts/vps-creditar-saldo-apostador.mjs
 */
import fs from "node:fs";
import path from "node:path";

const EMAIL = String(process.env.EMAIL || "").trim().toLowerCase();
const AMOUNT_CENTS = Math.trunc(Number(process.env.AMOUNT_CENTS || 0));
const REQUEST_ID = String(process.env.REQUEST_ID || "").trim();
const APPLY = process.env.APPLY === "1";
const REASON = String(process.env.REASON || "crédito manual Saldo Apostador").trim();

for (const file of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  path.resolve(".env"),
].filter(Boolean)) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const key =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = String(
  process.env.ARBISHIELD_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.API_EXTERNAL_URL ||
    "http://127.0.0.1:8000"
).replace(/\/$/, "");

if (!key || !EMAIL || !(AMOUNT_CENTS > 0) || !REQUEST_ID) {
  throw new Error("Informe EMAIL, AMOUNT_CENTS positivo, REQUEST_ID e SERVICE_ROLE_KEY");
}

async function api(route, { method = "GET", body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${route}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

function money(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main() {
  let user = null;
  for (let page = 1; page <= 40 && !user; page++) {
    const result = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = result.users || result;
    user = users.find((item) => String(item.email || "").toLowerCase() === EMAIL);
    if (!Array.isArray(users) || users.length < 200) break;
  }
  if (!user) throw new Error(`usuário não encontrado: ${EMAIL}`);

  const existing = await api(
    `/rest/v1/wallet_transactions?select=id&user_id=eq.${encodeURIComponent(user.id)}&metadata->>request_id=eq.${encodeURIComponent(REQUEST_ID)}&limit=1`
  );
  if (Array.isArray(existing) && existing.length) {
    throw new Error(`REQUEST_ID já aplicado: ${REQUEST_ID}`);
  }

  const profile = (await api(
    `/rest/v1/profiles?select=id,full_name,balance_cents&id=eq.${encodeURIComponent(user.id)}&limit=1`
  ))[0];
  if (!profile) throw new Error("perfil não encontrado");
  const before = Math.trunc(Number(profile.balance_cents || 0));
  const after = before + AMOUNT_CENTS;
  console.log(`${profile.full_name || EMAIL}: ${money(before)} → ${money(after)}`);
  if (!APPLY) {
    console.log("SIMULAÇÃO — repita com APPLY=1 para aplicar.");
    return;
  }

  await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: { balance_cents: after, updated_at: new Date().toISOString() },
  });
  await api("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: user.id,
      type: "admin_adjustment",
      amount_cents: AMOUNT_CENTS,
      balance_before_cents: before,
      balance_after_cents: after,
      metadata: { request_id: REQUEST_ID, reason: REASON, bucket: "balance_cents" },
    },
  });
  console.log(`OK — creditado ${money(AMOUNT_CENTS)} no Saldo Apostador.`);
}

main().catch((error) => {
  console.error("FALHA:", error.message || error);
  process.exit(1);
});
