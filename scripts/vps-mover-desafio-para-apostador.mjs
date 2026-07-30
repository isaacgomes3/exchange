#!/usr/bin/env node
/**
 * Move saldo Desafio → Apostador (balance_cents / Real).
 * Caso: Lucas Gonçalves dos Santos — R$ 150,00 (id~1210f201…)
 *
 * Relatório:
 *   node scripts/vps-mover-desafio-para-apostador.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-mover-desafio-para-apostador.mjs
 *
 * Marker: vps-mover-desafio-para-apostador-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(
  process.env.NAME || "Lucas Gonçalves dos Santos"
).trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "1210f201").trim().toLowerCase();
const AMOUNT_CENTS = Math.round(Number(process.env.AMOUNT_CENTS || 15000)); // R$ 150
const REASON = String(
  process.env.REASON ||
    "admin: transferir Desafio → Apostador (Lucas Gonçalves dos Santos)"
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
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 240)}`);
  return data;
}

async function main() {
  console.log("==> Mover Desafio → Apostador (Real)");
  console.log("    marker: vps-mover-desafio-para-apostador-v1");
  console.log("    valor pedido:", money(AMOUNT_CENTS));
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    nome~", NAME);
  console.log("    id~", ID_PREFIX || "—");

  const select =
    "id,full_name,account_status,balance_cents,reusable_balance_cents," +
    "deduction_balance_cents,desafio_balance_cents,locked_balance_cents,updated_at";

  let candidates = [];
  if (ID_PREFIX) {
    const rows = await sb(
      `/rest/v1/profiles?select=${select}&order=created_at.desc&limit=5000`
    );
    candidates = (Array.isArray(rows) ? rows : []).filter((r) =>
      String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
    );
  }
  if (!candidates.length) {
    const q = encodeURIComponent("%" + NAME + "%");
    const rows = await sb(
      `/rest/v1/profiles?select=${select}&full_name=ilike.${q}&order=created_at.desc&limit=20`
    );
    candidates = Array.isArray(rows) ? rows : [];
  }

  if (!candidates.length) {
    throw new Error(`sem profile nome~${NAME} id~${ID_PREFIX}`);
  }

  const want = norm(NAME);
  let list = candidates.filter((r) => norm(r.full_name).includes(want));
  if (!list.length) list = candidates;

  if (list.length > 1) {
    console.log("Matches:");
    list.forEach((r) =>
      console.log(
        `  ${r.id}  ${r.full_name}  desafio=${money(r.desafio_balance_cents)}  real=${money(r.balance_cents)}`
      )
    );
  }

  const p = list[0];
  if (ID_PREFIX && !String(p.id).toLowerCase().startsWith(ID_PREFIX)) {
    throw new Error(
      `profile ${p.id} não começa com id prefix ${ID_PREFIX} — abortado`
    );
  }

  const bal = n(p.balance_cents);
  const desafio = n(p.desafio_balance_cents);
  const move = Math.min(AMOUNT_CENTS, desafio);
  const apostadorBefore =
    bal + n(p.reusable_balance_cents) + n(p.deduction_balance_cents);

  console.log("\n  user:", p.id);
  console.log("  nome:", p.full_name || "—");
  console.log("  status:", p.account_status || "—");
  console.log("  Apostador (antes):", money(apostadorBefore));
  console.log("  Real:", money(bal));
  console.log("  Desafio:", money(desafio));
  console.log("  a mover:", money(move));

  if (move <= 0) {
    console.log("\n  Nada a mover (desafio insuficiente ou zero).");
    console.log("OK");
    return;
  }
  if (move < AMOUNT_CENTS) {
    console.log(
      `  ⚠ desafio (${money(desafio)}) < pedido (${money(AMOUNT_CENTS)}) — move só o disponível`
    );
  }

  const nextBal = bal + move;
  const nextDesafio = desafio - move;
  const apostadorAfter =
    nextBal + n(p.reusable_balance_cents) + n(p.deduction_balance_cents);

  console.log(
    "  depois → Apostador",
    money(apostadorAfter),
    "| Real",
    money(nextBal),
    "| Desafio",
    money(nextDesafio)
  );

  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-mover-desafio-para-apostador.mjs");
    console.log("OK");
    return;
  }

  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        desafio_balance_cents: nextDesafio,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        desafio_balance_cents: nextDesafio,
      },
    });
  }

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: move,
      balance_before_cents: bal,
      balance_after_cents: nextBal,
      metadata: {
        reason: REASON,
        source: "admin_manual_vps",
        from_bucket: "desafio_balance_cents",
        to_bucket: "balance_cents",
        amount_cents: move,
        desafio_before_cents: desafio,
        desafio_after_cents: nextDesafio,
        note: "reclassificação Desafio → Apostador (Real)",
        fix: "vps-mover-desafio-para-apostador-v1",
      },
    },
  });

  const verify = await sb(
    `/rest/v1/profiles?select=${select}&id=eq.${encodeURIComponent(p.id)}&limit=1`
  );
  const v = Array.isArray(verify) ? verify[0] : verify;
  console.log("\n  OK movido", money(move), "Desafio → Apostador (Real)");
  if (v) {
    console.log(
      "  conferência:",
      "Real",
      money(v.balance_cents),
      "| Desafio",
      money(v.desafio_balance_cents)
    );
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
