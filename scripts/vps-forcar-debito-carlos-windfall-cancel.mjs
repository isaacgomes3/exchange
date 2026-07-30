#!/usr/bin/env node
/**
 * FORÇA débito do windfall do cancel fee_upfront (Carlos Roberto).
 *
 * Evidência:
 *   create cobrou só R$ 96,11 · cancel devolveu R$ 1.000
 *   Apostador ficou R$ 10.971,41 (deveria ~ R$ 10.067,52)
 *   clawback = 100000 − 9611 = 90389 centavos
 *
 * Na VPS (com SERVICE_ROLE_KEY no .env):
 *   node scripts/vps-forcar-debito-carlos-windfall-cancel.mjs          # dry-run
 *   FIX=1 node scripts/vps-forcar-debito-carlos-windfall-cancel.mjs    # aplica
 *
 * Overrides:
 *   EMAIL=... USER_ID=... NAME="Carlos Roberto"
 *   EXPECT_BALANCE_CENTS=1097141
 *   CLAWBACK_CENTS=90389
 *   TARGET_BALANCE_CENTS=1006752
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const EMAIL = String(process.env.EMAIL || "carloskku4@gmail.com").trim().toLowerCase();
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const EXPECT_BALANCE_CENTS = Math.trunc(
  Number(process.env.EXPECT_BALANCE_CENTS || 1_097_141)
);
const CLAWBACK_CENTS = Math.trunc(Number(process.env.CLAWBACK_CENTS || 90_389));
const TARGET_BALANCE_CENTS = Math.trunc(
  Number(process.env.TARGET_BALANCE_CENTS || 1_006_752)
);
const REPAIR_TAG = "force-debit-carlos-windfall-cancel-v1";

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

async function sb(p, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...headers,
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
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents&limit=1`
    );
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) throw new Error(`USER_ID não encontrado: ${USER_ID_ENV}`);
    return p;
  }

  // profiles-sem-coluna-email-v1 — email só em auth.users
  try {
    const auth = await sb(
      `/auth/v1/admin/users?page=1&per_page=200`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const users = auth?.users || (Array.isArray(auth) ? auth : []);
    const hit = users.find(
      (u) => String(u.email || "").toLowerCase() === EMAIL
    );
    if (hit?.id) {
      const rows = await sb(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(hit.id)}&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents&limit=1`
      );
      if (Array.isArray(rows) && rows[0]) return rows[0];
    }
  } catch (e) {
    console.warn("  auth admin users:", e.message || e);
  }

  // 2) nome + saldo esperado (espelho mostra Carlos Roberto com R$ 10.971,41)
  const byName = await sb(
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents&limit=20`
  );
  const list = Array.isArray(byName) ? byName : [];
  if (!list.length) throw new Error(`Nenhum perfil com nome ~ ${NAME}`);

  const exactBal = list.filter((p) => n(p.balance_cents) === EXPECT_BALANCE_CENTS);
  if (exactBal.length === 1) return exactBal[0];
  if (exactBal.length > 1) {
    console.log("Vários com saldo esperado — use USER_ID=");
    for (const p of exactBal) console.log(" ", p.id, p.full_name, money(p.balance_cents));
    process.exit(2);
  }

  // Prefer nome Carlos Roberto e saldo próximo do windfall
  const ranked = list
    .map((p) => ({
      p,
      score:
        (String(p.full_name || "").toLowerCase().includes("carlos") ? 10 : 0) +
        (String(p.full_name || "").toLowerCase().includes("roberto") ? 10 : 0) +
        (Math.abs(n(p.balance_cents) - EXPECT_BALANCE_CENTS) < 100 ? 50 : 0) +
        (n(p.balance_cents) === EXPECT_BALANCE_CENTS ? 100 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  console.log("Candidatos por nome:");
  for (const { p, score } of ranked.slice(0, 8)) {
    console.log(" ", score, p.id, p.full_name, money(p.balance_cents));
  }
  if (ranked[0]?.score >= 20) return ranked[0].p;
  throw new Error("Não consegui identificar o Carlos com segurança — passe USER_ID=");
}

async function alreadyApplied(userId) {
  const txs = await sb(
    `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(userId)}&select=id,type,amount_cents,metadata,created_at&order=created_at.desc&limit=40`
  );
  const list = Array.isArray(txs) ? txs : [];
  return list.some((t) => {
    const m = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    return (
      m.repair_tag === REPAIR_TAG ||
      (m.clawback === true && Math.abs(n(t.amount_cents)) === CLAWBACK_CENTS)
    );
  });
}

async function main() {
  console.log("==> Forçar débito windfall cancel", FIX ? "(FIX=1)" : "(dry-run)");
  console.log("    expect Real:", money(EXPECT_BALANCE_CENTS));
  console.log("    clawback:   ", money(CLAWBACK_CENTS));
  console.log("    target Real:", money(TARGET_BALANCE_CENTS));
  console.log("    tag:", REPAIR_TAG);

  const prof = await findUser();
  const bal = n(prof.balance_cents);
  console.log(
    "\n    user:",
    prof.id,
    "|",
    prof.full_name || "-",
    "\n    Real:",
    money(bal),
    "| Congelado:",
    money(prof.locked_balance_cents),
    "| Reembolso:",
    money(prof.deduction_balance_cents),
    "| Desafio:",
    money(prof.desafio_balance_cents)
  );

  if (await alreadyApplied(prof.id)) {
    console.log("\nJá existe clawback com esta tag — nada a fazer.");
    if (bal === TARGET_BALANCE_CENTS) {
      console.log("Saldo já no alvo", money(TARGET_BALANCE_CENTS));
    } else {
      console.log(
        "AVISO: tag presente mas saldo atual",
        money(bal),
        "≠ alvo",
        money(TARGET_BALANCE_CENTS)
      );
    }
    return;
  }

  if (bal === TARGET_BALANCE_CENTS) {
    console.log("\nSaldo já está no alvo", money(TARGET_BALANCE_CENTS), "— nada a debitar.");
    return;
  }

  // Aceita saldo atual = esperado, ou esperado−já debitado parcialmente, ou qualquer >= alvo+clawback
  let debit = CLAWBACK_CENTS;
  let next = bal - debit;

  if (bal === EXPECT_BALANCE_CENTS) {
    next = TARGET_BALANCE_CENTS;
    debit = bal - next;
  } else if (bal > TARGET_BALANCE_CENTS && bal - TARGET_BALANCE_CENTS === CLAWBACK_CENTS) {
    next = TARGET_BALANCE_CENTS;
    debit = CLAWBACK_CENTS;
  } else if (Math.abs(bal - EXPECT_BALANCE_CENTS) <= 2) {
    // tolerância 2 centavos
    next = TARGET_BALANCE_CENTS;
    debit = bal - next;
  } else {
    console.error(
      `\nERRO: saldo Real atual ${money(bal)} não é o esperado ${money(EXPECT_BALANCE_CENTS)}.`
    );
    console.error(
      "Não aplico débito cego. Se for o mesmo caso, rode com:\n" +
        `  EXPECT_BALANCE_CENTS=${bal} TARGET_BALANCE_CENTS=${bal - CLAWBACK_CENTS} FIX=1 node ...`
    );
    process.exit(3);
  }

  if (!(debit > 0) || next < 0) {
    console.error("ERRO: débito inválido", debit, next);
    process.exit(4);
  }

  console.log("\n    Plano: Real", money(bal), "→", money(next), `(−${money(debit)})`);

  if (!FIX) {
    console.log("\nDry-run OK. Rode com FIX=1 para aplicar.");
    return;
  }

  const patched = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(prof.id)}`,
    {
      method: "PATCH",
      body: {
        balance_cents: next,
        updated_at: new Date().toISOString(),
      },
    }
  );
  const after = Array.isArray(patched) ? patched[0] : null;
  const afterBal = after ? n(after.balance_cents) : next;

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: prof.id,
      type: "admin_adjustment",
      amount_cents: -debit,
      ref: prof.id,
      metadata: {
        repair: true,
        clawback: true,
        repair_tag: REPAIR_TAG,
        note:
          "Clawback forçado: cancel fee_upfront devolveu stake R$1.000; só havia sido cobrada dedução R$96,11",
        expect_balance_cents: EXPECT_BALANCE_CENTS,
        clawback_cents: debit,
        target_balance_cents: TARGET_BALANCE_CENTS,
        balance_before_cents: bal,
        balance_after_cents: afterBal,
        source: "vps-forcar-debito-carlos-windfall-cancel.mjs",
      },
    },
  }).catch((e) => console.warn("tx warn:", e.message || e));

  console.log("\nOK — Real agora", money(afterBal));
  if (afterBal !== TARGET_BALANCE_CENTS) {
    console.warn(
      "AVISO: após patch saldo",
      money(afterBal),
      "≠ alvo",
      money(TARGET_BALANCE_CENTS)
    );
  } else {
    console.log("Alvo atingido:", money(TARGET_BALANCE_CENTS));
  }
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
