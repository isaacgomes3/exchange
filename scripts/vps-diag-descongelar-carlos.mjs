#!/usr/bin/env node
/**
 * DIAGNÓSTICO + FORCE descongelar Carlos (obrigatório verificar locked=0).
 *
 * Na VPS:
 *   node scripts/vps-diag-descongelar-carlos.mjs
 *   FIX=1 node scripts/vps-diag-descongelar-carlos.mjs
 *
 * Flags:
 *   UNLOCK_ONLY=1  → só zera locked e devolve stake (sem cobrar fees)
 *   ZERO_ONLY=1    → só zera locked (não devolve — emergência)
 *   USER_ID=...    → força este perfil
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const UNLOCK_ONLY = process.env.UNLOCK_ONLY === "1";
const ZERO_ONLY = process.env.ZERO_ONLY === "1";
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com").trim().toLowerCase();
const FEE = Math.trunc(Number(process.env.FEE_CENTS || 9111));
const COMM = Math.trunc(Number(process.env.COMMISSION_CENTS || 500));
const TAG = "diag-force-unfreeze-carlos-v7b";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  let n = 0;
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
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
      n++;
    }
  }
  console.log("  env loaded:", file, `(${n} keys)`);
  return true;
}

console.log("==> Procurando .env");
const envCandidates = [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  "/opt/arbishield/scripts/.env",
  "/root/.arbishield.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean);
let envOk = false;
for (const f of envCandidates) envOk = loadEnvFile(f) || envOk;
if (!envOk) console.warn("  AVISO: nenhum .env encontrado");

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

console.log("==> Conexão");
console.log("  URL:", SUPABASE_URL);
console.log("  KEY:", SERVICE_KEY ? `${SERVICE_KEY.slice(0, 8)}…(${SERVICE_KEY.length})` : "AUSENTE");
if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente — não consigo PATCH");
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
  if (!res.ok) {
    throw new Error(`${method} ${res.status} ${p}\n${String(text).slice(0, 800)}`);
  }
  return data;
}

async function loadCandidates() {
  const out = [];
  const seen = new Set();
  function push(list) {
    for (const p of Array.isArray(list) ? list : []) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  async function tryPush(label, path) {
    try {
      push(await sb(path));
    } catch (e) {
      console.warn("  skip", label + ":", e.message || e);
    }
  }
  const sel =
    "id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,updated_at";

  console.log("  (profiles.email inexistente — buscando por nome/saldo/locked)");

  if (USER_ID_ENV) {
    await tryPush(
      "USER_ID",
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=${sel}`
    );
  }
  await tryPush(
    "nome Carlos Roberto",
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=${sel}&limit=30`
  );
  await tryPush(
    "locked=100000",
    `/rest/v1/profiles?locked_balance_cents=eq.100000&select=${sel}&limit=20`
  );
  await tryPush(
    "print 806752/100000",
    `/rest/v1/profiles?balance_cents=eq.806752&locked_balance_cents=eq.100000&select=${sel}&limit=10`
  );
  await tryPush(
    "nome Carlos*",
    `/rest/v1/profiles?full_name=ilike.*Carlos*&select=${sel}&order=locked_balance_cents.desc&limit=30`
  );
  return out;
}

async function activeProtections(userId) {
  const lay = await sb(
    `/rest/v1/protections?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,amount_cents,responsibility_cents,odd,created_at&limit=20`
  ).catch(() => []);
  const back = await sb(
    `/rest/v1/back_protections?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=id,amount_cents,odd,created_at&limit=20`
  ).catch(() => []);
  return [...(Array.isArray(lay) ? lay : []), ...(Array.isArray(back) ? back : [])];
}

async function patchUnlock(user) {
  const bal = n(user.balance_cents);
  const locked = n(user.locked_balance_cents);
  let nextBal = bal;
  let nextLocked = 0;
  let fee = 0;
  let comm = 0;

  if (ZERO_ONLY) {
    nextBal = bal;
    nextLocked = 0;
  } else if (UNLOCK_ONLY) {
    nextBal = bal + locked;
    nextLocked = 0;
  } else {
    // v7: devolve + cobra fees (proporcional se locked != 1000)
    const scale = locked === 100000 ? 1 : locked / 100000;
    fee = Math.round(FEE * scale);
    comm = Math.round(COMM * scale);
    nextBal = bal + locked - fee - comm;
    nextLocked = 0;
  }

  console.log("\n  PLANO", user.id, user.full_name || "");
  console.log("    Real", money(bal), "→", money(nextBal));
  console.log("    Locked", money(locked), "→", money(nextLocked));
  if (!ZERO_ONLY && !UNLOCK_ONLY) {
    console.log("    Fees", money(fee), "+", money(comm));
  }

  if (!FIX) return { dry: true, nextBal, nextLocked, fee, comm };

  // PATCH 1
  let patched = await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: nextBal,
      locked_balance_cents: 0,
      reusable_balance_cents: 0,
      updated_at: new Date().toISOString(),
    },
  });
  let row = Array.isArray(patched) ? patched[0] : patched;
  console.log(
    "  PATCH1 → Real",
    money(row?.balance_cents),
    "Locked",
    money(row?.locked_balance_cents)
  );

  // PATCH 2 se locked ainda > 0 (schema sem updated_at etc)
  if (n(row?.locked_balance_cents) > 0) {
    patched = await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: { locked_balance_cents: 0, balance_cents: nextBal },
    });
    row = Array.isArray(patched) ? patched[0] : patched;
    console.log(
      "  PATCH2 → Real",
      money(row?.balance_cents),
      "Locked",
      money(row?.locked_balance_cents)
    );
  }

  // VERIFY SELECT
  const verify = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,balance_cents,locked_balance_cents,updated_at&limit=1`
  );
  const v = Array.isArray(verify) ? verify[0] : null;
  console.log(
    "  VERIFY → Real",
    money(v?.balance_cents),
    "Locked",
    money(v?.locked_balance_cents),
    "updated",
    v?.updated_at
  );

  if (n(v?.locked_balance_cents) > 0) {
    throw new Error(
      `VERIFY FALHOU: locked ainda ${money(v.locked_balance_cents)} no perfil ${user.id}`
    );
  }

  // TX audit (best-effort)
  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: user.id,
      type: "protection_settlement",
      amount_cents: fee > 0 ? -fee : 0,
      ref: `${TAG}:${user.id}`,
      metadata: {
        repair_tag: TAG,
        fix: TAG,
        outcome: "exchange",
        unlocked_locked: true,
        stake_returned: !ZERO_ONLY,
        returned_stake_cents: ZERO_ONLY ? 0 : locked,
        fee_cents: fee,
        exchange_commission_cents: comm,
        unlock_only: UNLOCK_ONLY || false,
        zero_only: ZERO_ONLY || false,
        balance_before_cents: bal,
        locked_before_cents: locked,
        balance_after_cents: n(v?.balance_cents),
        note: "DIAG force unfreeze Carlos — VERIFY locked=0",
      },
    },
  }).catch((e) => console.warn("  tx warn:", e.message || e));

  if (comm > 0) {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: user.id,
        type: "exchange_commission",
        amount_cents: -comm,
        ref: `${TAG}:${user.id}`,
        metadata: {
          repair_tag: TAG,
          fix: TAG,
          label: "Comissão Exchange (4,5% do lucro)",
          exchange_commission_cents: comm,
        },
      },
    }).catch((e) => console.warn("  tx commission warn:", e.message || e));
  }

  return { ok: true, nextBal: n(v?.balance_cents), nextLocked: n(v?.locked_balance_cents) };
}

async function main() {
  console.log("==> Modo", FIX ? "FIX=1" : "DRY-RUN", {
    UNLOCK_ONLY,
    ZERO_ONLY,
  });

  // ping
  try {
    await sb(`/rest/v1/profiles?select=id&limit=1`);
    console.log("  REST OK");
  } catch (e) {
    console.error("  REST FALHOU:", e.message || e);
    process.exit(2);
  }

  const cands = await loadCandidates();
  console.log("\n==> Candidatos encontrados:", cands.length);
  for (const p of cands) {
    console.log(
      " ",
      p.id,
      "|",
      p.full_name || "-",
      "|",
      "-",
      "| Real",
      money(p.balance_cents),
      "| Locked",
      money(p.locked_balance_cents)
    );
  }

  const targets = cands.filter((p) => n(p.locked_balance_cents) > 0);
  if (!targets.length) {
    console.log("\nNenhum perfil com locked>0 entre os candidatos.");
    console.log("Se a UI ainda mostra Congelado, pode ser:");
    console.log("  1) impersonação de OUTRO user_id");
    console.log("  2) cache do browser");
    console.log("  3) UI somando proteções active (ver abaixo)");
    // ainda assim inspeciona active protections do email/nome
    for (const p of cands.slice(0, 3)) {
      const act = await activeProtections(p.id);
      console.log("  active protections", p.id, act.length, act);
    }
    return;
  }

  console.log("\n==> Alvos com locked>0:", targets.length);
  for (const p of targets) {
    const act = await activeProtections(p.id);
    console.log("  active protections:", act.length, act.map((r) => r.id));
    await patchUnlock(p);
  }

  if (!FIX) {
    console.log("\nDry-run OK. Aplique AGORA:");
    console.log("  FIX=1 node scripts/vps-diag-descongelar-carlos.mjs");
    console.log("Se quiser só zerar locked sem fees:");
    console.log("  UNLOCK_ONLY=1 FIX=1 node scripts/vps-diag-descongelar-carlos.mjs");
    return;
  }

  console.log("\nOK — VERIFY locked=0 nos alvos. Hard-refresh no Financeiro.");
}

main().catch((e) => {
  console.error("\nERRO FATAL:", e.message || e);
  process.exit(1);
});
