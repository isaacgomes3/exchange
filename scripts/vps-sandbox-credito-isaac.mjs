#!/usr/bin/env node
/**
 * Crédito para testes (isaacgomes3@gmail.com)
 *
 * Padrão (não mexe no saldo REAL sacável):
 *   - demo_balance_cents  += R$ 1.000  (proteção DEMO)
 *   - desafio_balance_cents += R$ 1.000
 *
 * Relatório:
 *   node scripts/vps-sandbox-credito-isaac.mjs
 * Aplicar na VPS:
 *   FIX=1 node /opt/arbishield/scripts/vps-sandbox-credito-isaac.mjs
 *
 * Se quiser saldo REAL (aparece/afeta produção):
 *   FIX=1 REAL=1 node ...
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const REAL = process.env.REAL === "1" || process.env.REAL === "true";
const EMAIL = String(
  process.env.EMAIL || "isaacgomes3@gmail.com"
)
  .trim()
  .toLowerCase();
const AMOUNT_CENTS = Math.round(Number(process.env.AMOUNT_CENTS || 100_000)); // R$ 1.000

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
if (!(AMOUNT_CENTS > 0)) {
  console.error("ERRO: AMOUNT_CENTS inválido");
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 300)}`);
  return data;
}

async function authAdmin(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function findUserIdByEmail(email) {
  const q = await authAdmin(
    `/auth/v1/admin/users?page=1&per_page=200&email=${encodeURIComponent(email)}`
  );
  if (q.ok) {
    const batch = Array.isArray(q.data?.users)
      ? q.data.users
      : Array.isArray(q.data)
        ? q.data
        : [];
    const hit = batch.find(
      (u) => String(u.email || "").trim().toLowerCase() === email
    );
    if (hit?.id) return String(hit.id);
  }

  for (let page = 1; page <= 30; page += 1) {
    const { ok, status, data } = await authAdmin(
      `/auth/v1/admin/users?page=${page}&per_page=200`
    );
    if (!ok) throw new Error(`auth admin page ${page}: HTTP ${status}`);
    const batch = Array.isArray(data?.users)
      ? data.users
      : Array.isArray(data)
        ? data
        : [];
    const hit = batch.find(
      (u) => String(u.email || "").trim().toLowerCase() === email
    );
    if (hit?.id) return String(hit.id);
    if (batch.length < 200) break;
  }
  throw new Error(`usuário não encontrado no Auth: ${email}`);
}

async function main() {
  console.log("==> Crédito sandbox / teste");
  console.log("    email:", EMAIL);
  console.log("    valor:", money(AMOUNT_CENTS), "em cada carteira alvo");
  console.log("    modo:", REAL ? "REAL+desafio (afeta produção)" : "DEMO+desafio (padrão)");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("");
  console.log(
    "AVISO: o banco é o mesmo da produção. DEMO evita mexer no saldo sacável;"
  );
  console.log("       desafio_balance aparece no app de produção também.");
  console.log("");

  const userId = await findUserIdByEmail(EMAIL);
  const rows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(
      userId
    )}&select=id,full_name,account_status,balance_cents,demo_balance_cents,desafio_balance_cents,reusable_balance_cents,locked_balance_cents&limit=1`
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new Error(`profile não encontrado: ${userId}`);

  const beforeBal = n(p.balance_cents);
  const beforeDemo = n(p.demo_balance_cents);
  const beforeDesafio = n(p.desafio_balance_cents);

  const patch = {
    desafio_balance_cents: beforeDesafio + AMOUNT_CENTS,
    updated_at: new Date().toISOString(),
  };
  if (REAL) {
    patch.balance_cents = beforeBal + AMOUNT_CENTS;
  } else {
    patch.demo_balance_cents = beforeDemo + AMOUNT_CENTS;
  }

  console.log("  user:", p.id);
  console.log("  nome:", p.full_name || "—");
  console.log("  status:", p.account_status || "—");
  if (REAL) {
    console.log("  saldo REAL:", money(beforeBal), "→", money(patch.balance_cents));
  } else {
    console.log(
      "  saldo DEMO:",
      money(beforeDemo),
      "→",
      money(patch.demo_balance_cents)
    );
  }
  console.log(
    "  desafio:",
    money(beforeDesafio),
    "→",
    money(patch.desafio_balance_cents)
  );

  if (!FIX) {
    console.log("\nPara aplicar:");
    console.log(
      "  FIX=1 node /opt/arbishield/scripts/vps-sandbox-credito-isaac.mjs"
    );
    console.log("Saldo REAL (não recomendado p/ teste):");
    console.log(
      "  FIX=1 REAL=1 node /opt/arbishield/scripts/vps-sandbox-credito-isaac.mjs"
    );
    console.log("OK");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: patch,
  });

  const txType = REAL ? "manual_credit" : "manual_credit";
  const metaBase = {
    reason: "credito sandbox teste protecao/desafio",
    source: "vps-sandbox-credito-isaac",
    email: EMAIL,
    sandbox: true,
    wallet: REAL ? "balance_cents" : "demo_balance_cents",
  };

  // Tx carteira principal/demo
  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: p.id,
      type: txType,
      amount_cents: AMOUNT_CENTS,
      balance_before_cents: REAL ? beforeBal : beforeDemo,
      balance_after_cents: REAL
        ? patch.balance_cents
        : patch.demo_balance_cents,
      metadata: { ...metaBase, kind: REAL ? "real" : "demo" },
    },
  });

  // Tx desafio
  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: p.id,
      type: "desafio_deposit",
      amount_cents: AMOUNT_CENTS,
      balance_before_cents: beforeDesafio,
      balance_after_cents: patch.desafio_balance_cents,
      metadata: { ...metaBase, kind: "desafio" },
    },
  });

  console.log("\nOK creditado");
  if (REAL) {
    console.log("  REAL  +", money(AMOUNT_CENTS));
  } else {
    console.log("  DEMO  +", money(AMOUNT_CENTS), "(use balanceType=DEMO em Proteger)");
  }
  console.log("  DESAFIO +", money(AMOUNT_CENTS));
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
