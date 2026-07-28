#!/usr/bin/env node
/**
 * Repara Reembolsos já liquidados por worker legado sem crédito no saldo.
 * Executar primeiro sem APPLY=1; depois confirmar e reaplicar com APPLY=1.
 */
import fs from "node:fs";
import path from "node:path";
import { settlementCreditParts } from "./lib/protection-flow-contract.mjs";

const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com").trim().toLowerCase();
const APPLY = process.env.APPLY === "1";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
for (const file of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  path.resolve(".env"),
].filter(Boolean)) loadEnv(file);

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
if (!key) throw new Error("SERVICE_ROLE_KEY ausente");

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

async function userIdForEmail() {
  for (let page = 1; page <= 40; page++) {
    const users = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const list = users.users || users;
    const user = list.find((item) => String(item.email || "").toLowerCase() === EMAIL);
    if (user) return user.id;
    if (!Array.isArray(list) || list.length < 200) break;
  }
  throw new Error(`usuário não encontrado: ${EMAIL}`);
}

function cents(value) {
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
}

async function main() {
  const userId = await userIdForEmail();
  const profile = (await api(
    `/rest/v1/profiles?select=id,full_name,deduction_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`
  ))[0];
  if (!profile) throw new Error("perfil não encontrado");

  const rows = [];
  for (const table of ["protections", "back_protections"]) {
    const result = await api(
      `/rest/v1/${table}?select=*&user_id=eq.${encodeURIComponent(userId)}&status=eq.lost_exchange&order=settled_at.asc&limit=1000`
    );
    rows.push(...(Array.isArray(result) ? result : []).map((row) => ({ ...row, table })));
  }

  let total = 0;
  console.log(`==> Reparo Saldo Reembolso: ${profile.full_name || EMAIL}`);
  console.log(`    modo: ${APPLY ? "APLICAR" : "SIMULAÇÃO"}`);
  for (const row of rows) {
    const expected = settlementCreditParts(row, "arbishield").total;
    if (!(expected > 0)) continue;
    const txs = await api(
      `/rest/v1/wallet_transactions?select=id,amount_cents,metadata&type=eq.protection_settlement&ref=eq.${encodeURIComponent(row.id)}&limit=20`
    );
    const credited = (Array.isArray(txs) ? txs : []).some(
      (tx) => cents(tx.amount_cents) >= expected
    );
    if (credited) {
      console.log(`  pular ${row.id}: já possui crédito de ${expected}¢`);
      continue;
    }
    total += expected;
    console.log(`  ${APPLY ? "creditar" : "simular"} ${row.id}: ${expected}¢`);
    if (!APPLY) continue;

    const current = (await api(
      `/rest/v1/profiles?select=deduction_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`
    ))[0];
    const after = cents(current?.deduction_balance_cents) + expected;
    await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { deduction_balance_cents: after },
    });
    await api("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: userId,
        type: "protection_settlement",
        amount_cents: expected,
        ref: row.id,
        metadata: {
          protection_id: row.id,
          outcome: "arbishield",
          bucket: "deduction_balance_cents",
          repair: "settled_reembolso_without_credit_v1",
        },
      },
    });
  }
  console.log(`TOTAL ${APPLY ? "creditado" : "a creditar"}: ${(total / 100).toFixed(2)}`);
  if (!APPLY) console.log("Revise a lista e rode novamente com APPLY=1 para confirmar.");
}

main().catch((error) => {
  console.error("FALHA:", error.message || error);
  process.exit(1);
});
