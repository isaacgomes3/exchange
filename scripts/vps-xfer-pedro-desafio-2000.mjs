#!/usr/bin/env node
/**
 * Transferência admin — PEDRO IURI TEIXEIRA DOS SANTOS
 *
 *   Reembolso (deduction_balance_cents)  − R$ 450,00
 *   Jogador / Real (balance_cents)      − R$ 1.550,00
 *   Desafio (desafio_balance_cents)     + R$ 2.000,00
 *
 * Relatório:
 *   node scripts/vps-xfer-pedro-desafio-2000.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-xfer-pedro-desafio-2000.mjs
 *
 * Marker: vps-xfer-pedro-desafio-2000-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(
  process.env.NAME || "PEDRO IURI TEIXEIRA DOS SANTOS"
).trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf").trim().toLowerCase();
const REEMBOLSO_CENTS = Math.round(
  Number(process.env.REEMBOLSO_CENTS || 45_000)
); // R$ 450
const REAL_CENTS = Math.round(Number(process.env.REAL_CENTS || 155_000)); // R$ 1.550
const TOTAL_CENTS = REEMBOLSO_CENTS + REAL_CENTS; // R$ 2.000
const REASON = String(
  process.env.REASON ||
    "admin: transferir R$450 reembolso + R$1550 jogador → Desafio (Pedro Iuri)"
).trim();
const MARKER = "vps-xfer-pedro-desafio-2000-v1";

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
if (!(REEMBOLSO_CENTS >= 0) || !(REAL_CENTS >= 0) || !(TOTAL_CENTS > 0)) {
  console.error("ERRO: valores inválidos");
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  return data;
}

async function main() {
  console.log("==> Transferência → Desafio (Pedro Iuri)");
  console.log("    marker:", MARKER);
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log("    reembolso −", money(REEMBOLSO_CENTS));
  console.log("    jogador/real −", money(REAL_CENTS));
  console.log("    desafio +", money(TOTAL_CENTS));
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
    const first = NAME.split(/\s+/)[0] || "PEDRO";
    const rows = await sb(
      `/rest/v1/profiles?select=${select}&full_name=ilike.*${encodeURIComponent(first)}*&order=created_at.desc&limit=200`
    );
    const want = norm(NAME);
    candidates = (Array.isArray(rows) ? rows : []).filter((r) => {
      const nme = norm(r.full_name);
      return nme === want || nme.includes(want) || want.includes(nme);
    });
  }

  if (!candidates.length) {
    throw new Error(`perfil não encontrado: ${NAME} id~${ID_PREFIX}`);
  }

  const want = norm(NAME);
  candidates.sort(
    (a, b) =>
      Number(norm(b.full_name) === want) - Number(norm(a.full_name) === want) ||
      String(b.full_name || "").length - String(a.full_name || "").length
  );
  const p = candidates[0];

  if (ID_PREFIX && !String(p.id).toLowerCase().startsWith(ID_PREFIX)) {
    throw new Error(
      `profile ${p.id} não começa com id prefix ${ID_PREFIX} — abortado`
    );
  }

  const bal = n(p.balance_cents);
  const reemb = n(p.deduction_balance_cents);
  const desafio = n(p.desafio_balance_cents);
  const apostador =
    bal + n(p.reusable_balance_cents) + reemb;

  console.log("\n  user:", p.id);
  console.log("  nome:", p.full_name || "—");
  console.log("  status:", p.account_status || "—");
  console.log("  Apostador (antes):", money(apostador));
  console.log("  Real / jogador:", money(bal));
  console.log("  Reembolso:", money(reemb));
  console.log("  Desafio:", money(desafio));

  if (reemb < REEMBOLSO_CENTS) {
    throw new Error(
      `Reembolso insuficiente: tem ${money(reemb)}, precisa ${money(REEMBOLSO_CENTS)}`
    );
  }
  if (bal < REAL_CENTS) {
    throw new Error(
      `Saldo Real insuficiente: tem ${money(bal)}, precisa ${money(REAL_CENTS)}`
    );
  }

  const nextBal = bal - REAL_CENTS;
  const nextReemb = reemb - REEMBOLSO_CENTS;
  const nextDesafio = desafio + TOTAL_CENTS;
  const apostadorAfter =
    nextBal + n(p.reusable_balance_cents) + nextReemb;

  console.log("\n  depois →");
  console.log("  Apostador:", money(apostadorAfter));
  console.log("  Real / jogador:", money(nextBal));
  console.log("  Reembolso:", money(nextReemb));
  console.log("  Desafio:", money(nextDesafio));

  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-xfer-pedro-desafio-2000.mjs");
    console.log("OK");
    return;
  }

  // Idempotência: mesma transferência nos últimos 30 min
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  try {
    const recent = await sb(
      `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(p.id)}` +
        `&type=eq.internal_transfer&amount_cents=eq.${TOTAL_CENTS}` +
        `&created_at=gte.${encodeURIComponent(since)}` +
        `&select=id,metadata,created_at&order=created_at.desc&limit=10`
    );
    const dup = (Array.isArray(recent) ? recent : []).find((t) => {
      const m = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
      return m.fix === MARKER;
    });
    if (dup) {
      console.log("\n  Já aplicada recentemente (tx", dup.id, ") — abortando.");
      console.log("OK");
      return;
    }
  } catch (e) {
    console.warn("  aviso idempotência:", e.message || e);
  }

  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        deduction_balance_cents: nextReemb,
        desafio_balance_cents: nextDesafio,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        deduction_balance_cents: nextReemb,
        desafio_balance_cents: nextDesafio,
      },
    });
  }

  const verify = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}&select=id,balance_cents,deduction_balance_cents,desafio_balance_cents&limit=1`
  );
  const v = Array.isArray(verify) ? verify[0] : null;
  if (
    !v ||
    n(v.balance_cents) !== nextBal ||
    n(v.deduction_balance_cents) !== nextReemb ||
    n(v.desafio_balance_cents) !== nextDesafio
  ) {
    throw new Error(
      `Falha ao confirmar saldos: real=${n(v?.balance_cents)} reemb=${n(v?.deduction_balance_cents)} desafio=${n(v?.desafio_balance_cents)}`
    );
  }

  // TX consolidada
  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: p.id,
      type: "internal_transfer",
      amount_cents: TOTAL_CENTS,
      balance_before_cents: bal,
      balance_after_cents: nextBal,
      metadata: {
        reason: REASON,
        source: "admin_manual_vps",
        fix: MARKER,
        label: "Reembolso+Jogador → Desafio",
        from_buckets: {
          deduction_balance_cents: REEMBOLSO_CENTS,
          balance_cents: REAL_CENTS,
        },
        to_bucket: "desafio_balance_cents",
        reembolso_before_cents: reemb,
        reembolso_after_cents: nextReemb,
        real_before_cents: bal,
        real_after_cents: nextBal,
        desafio_before_cents: desafio,
        desafio_after_cents: nextDesafio,
        full_name: p.full_name || NAME,
      },
    },
  });

  // TX legível no extrato do reembolso
  if (REEMBOLSO_CENTS > 0) {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: p.id,
        type: "internal_transfer",
        amount_cents: REEMBOLSO_CENTS,
        balance_before_cents: reemb,
        balance_after_cents: nextReemb,
        metadata: {
          reason: REASON,
          source: "admin_manual_vps",
          fix: MARKER,
          from_bucket: "deduction_balance_cents",
          to_bucket: "desafio_balance_cents",
          label: "Saldo Reembolso → Desafio",
          part: "reembolso",
        },
      },
    });
  }

  // TX legível no extrato do real
  if (REAL_CENTS > 0) {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: p.id,
        type: "internal_transfer",
        amount_cents: REAL_CENTS,
        balance_before_cents: bal,
        balance_after_cents: nextBal,
        metadata: {
          reason: REASON,
          source: "admin_manual_vps",
          fix: MARKER,
          from_bucket: "balance_cents",
          to_bucket: "desafio_balance_cents",
          label: "Saldo Real → Desafio",
          part: "jogador",
        },
      },
    });
  }

  console.log("\n  OK transferido", money(TOTAL_CENTS), "→ Desafio");
  console.log("  Reembolso agora:", money(nextReemb));
  console.log("  Real agora:", money(nextBal));
  console.log("  Desafio agora:", money(nextDesafio));
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
