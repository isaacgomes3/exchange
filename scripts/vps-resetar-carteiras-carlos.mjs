#!/usr/bin/env node
/**
 * Zera todas as carteiras de Carlos Roberto e define R$ 10.000 no Apostador.
 *
 * Simular:
 *   REQUEST_ID=reset-carlos-20260728 node /opt/arbishield/scripts/vps-resetar-carteiras-carlos.mjs
 * Aplicar:
 *   APPLY=1 REQUEST_ID=reset-carlos-20260728 node /opt/arbishield/scripts/vps-resetar-carteiras-carlos.mjs
 */
import fs from "node:fs";
import path from "node:path";

const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com").trim().toLowerCase();
const REQUEST_ID = String(process.env.REQUEST_ID || "").trim();
const APPLY = process.env.APPLY === "1";
const APOSTADOR_CENTS = 1_000_000;
const FIELDS = [
  "balance_cents",
  "reusable_balance_cents",
  "deduction_balance_cents",
  "demo_balance_cents",
  "investor_balance_cents",
  "demo_balance_provider_cents",
  "desafio_balance_cents",
  "locked_balance_cents",
];

for (const file of ["/opt/arbishield/deploy/vps-supabase/.env", "/opt/arbishield/.env", path.resolve(".env")]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const key = process.env.ARBISHIELD_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = String(process.env.ARBISHIELD_SUPABASE_URL || process.env.SUPABASE_URL || process.env.API_EXTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
if (!key || !REQUEST_ID) throw new Error("Informe REQUEST_ID e configure SERVICE_ROLE_KEY");

async function api(route, { method = "GET", body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${route}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}
const money = (cents) => (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  let user = null;
  for (let page = 1; page <= 40 && !user; page++) {
    const result = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const list = result.users || result;
    user = list.find((item) => String(item.email || "").toLowerCase() === EMAIL);
    if (!Array.isArray(list) || list.length < 200) break;
  }
  if (!user) throw new Error(`usuário não encontrado: ${EMAIL}`);
  const prior = await api(`/rest/v1/wallet_transactions?select=id&user_id=eq.${encodeURIComponent(user.id)}&metadata->>request_id=eq.${encodeURIComponent(REQUEST_ID)}&limit=1`);
  if (Array.isArray(prior) && prior.length) throw new Error(`REQUEST_ID já aplicado: ${REQUEST_ID}`);
  const profile = (await api(`/rest/v1/profiles?select=id,full_name,${FIELDS.join(",")}&id=eq.${encodeURIComponent(user.id)}&limit=1`))[0];
  if (!profile) throw new Error("perfil não encontrado");
  const [protections, backProtections] = await Promise.all([
    api(`/rest/v1/protections?select=id&user_id=eq.${encodeURIComponent(user.id)}&status=in.(active,pending,review_odd)&limit=1000`),
    api(`/rest/v1/back_protections?select=id&user_id=eq.${encodeURIComponent(user.id)}&status=in.(active,pending,review_odd)&limit=1000`),
  ]);
  const openCount = (protections || []).length + (backProtections || []).length;
  if (openCount) {
    throw new Error(`existem ${openCount} proteções abertas; encerre-as antes de resetar as carteiras`);
  }

  console.log(`==> Reset de carteiras: ${profile.full_name || EMAIL}`);
  FIELDS.forEach((field) => console.log(`  ${field}: ${money(profile[field])} → ${field === "balance_cents" ? money(APOSTADOR_CENTS) : money(0)}`));
  if (!APPLY) return console.log("SIMULAÇÃO — repita com APPLY=1 para aplicar.");

  const patch = Object.fromEntries(FIELDS.map((field) => [field, 0]));
  patch.balance_cents = APOSTADOR_CENTS;
  patch.updated_at = new Date().toISOString();
  await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, { method: "PATCH", body: patch });
  await api("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: user.id,
      type: "admin_adjustment",
      amount_cents: APOSTADOR_CENTS,
      balance_before_cents: Number(profile.balance_cents || 0),
      balance_after_cents: APOSTADOR_CENTS,
      metadata: { request_id: REQUEST_ID, reason: "reset total de carteiras + crédito inicial", bucket: "balance_cents", reset_fields: FIELDS },
    },
  });
  console.log("OK — todas as carteiras zeradas; Apostador definido em R$ 10.000,00.");
}
main().catch((error) => { console.error("FALHA:", error.message || error); process.exit(1); });
