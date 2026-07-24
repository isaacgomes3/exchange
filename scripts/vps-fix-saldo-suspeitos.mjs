#!/usr/bin/env node
/**
 * Corrige saldos dos suspeitos da auditoria de injeção (LISTA PARA CORRIGIR).
 *
 * Regra: só DEBITA quando balance_cents > sugerido (nunca credita).
 * Pedro (saldo=sugerido) e icaro (sugerido>saldo) ficam intactos.
 *
 * Relatório:
 *   node scripts/vps-fix-saldo-suspeitos.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-fix-saldo-suspeitos.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";

/** Alvos da auditoria 22/07 (sugerido com locks como débito). */
const TARGETS = [
  {
    idPrefix: "cbd542d3",
    name: "CARLOS ROBERTO",
    emailHint: "carloskku4@gmail.com",
    suggestedCents: 1009219, // R$ 10.092,19
  },
  {
    idPrefix: "b6eb155d",
    name: "LUIZ PAULO GOMES SILVA DA ORA",
    suggestedCents: 158080, // R$ 1.580,80
  },
  {
    idPrefix: "24037bdf",
    name: "PEDRO IURI TEIXEIRA DOS SANTOS",
    suggestedCents: 624571, // R$ 6.245,71 (= atual → sem mudança)
  },
  {
    idPrefix: "7754b556",
    name: "icaro",
    suggestedCents: 99635, // R$ 996,35 (> atual → NÃO credita)
  },
];

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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 240)}`);
  return data;
}

async function resolveProfile(t) {
  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents,locked_balance_cents,updated_at&order=created_at.desc&limit=5000`
  );
  const list = (Array.isArray(rows) ? rows : []).filter((r) =>
    String(r.id || "").toLowerCase().startsWith(t.idPrefix.toLowerCase())
  );
  if (!list.length) throw new Error(`profile não encontrado id~${t.idPrefix}`);
  if (list.length > 1) {
    console.log(`  ⚠ vários matches id~${t.idPrefix}, usando o 1º:`);
    list.forEach((r) =>
      console.log(`    ${r.id}  ${r.full_name}  ${money(r.balance_cents)}`)
    );
  }
  return list[0];
}

async function main() {
  console.log("==> Correção de saldos (suspeitos auditoria injeção)");
  console.log("    FIX:", FIX ? "SIM — vai debitar" : "não (só relatório)");
  console.log("    regra: só debita se saldo atual > sugerido\n");

  let totalDebit = 0;
  const plan = [];

  for (const t of TARGETS) {
    const p = await resolveProfile(t);
    const bal = n(p.balance_cents);
    const target = Math.max(0, Math.round(t.suggestedCents));
    const debit = Math.max(0, bal - target);
    const action =
      debit > 0 ? "DEBITAR" : bal < target ? "IGNORAR (não credita)" : "OK (já no alvo)";

    console.log(`— ${t.name}`);
    console.log(`  id: ${p.id}`);
    console.log(`  status: ${p.account_status || "—"}`);
    console.log(`  saldo atual: ${money(bal)}`);
    console.log(`  sugerido:    ${money(target)}`);
    console.log(`  ação: ${action}${debit > 0 ? ` ${money(debit)} → ${money(target)}` : ""}`);

    plan.push({ t, p, bal, target, debit, action });
    totalDebit += debit;
  }

  console.log(`\n==> Total a debitar: ${money(totalDebit)}`);

  if (!FIX) {
    console.log("\n  Para aplicar:");
    console.log("  FIX=1 node scripts/vps-fix-saldo-suspeitos.mjs");
    console.log("OK");
    return;
  }

  if (totalDebit <= 0) {
    console.log("\n  Nada a debitar.");
    console.log("OK");
    return;
  }

  console.log("\n==> Aplicando…");
  for (const row of plan) {
    if (row.debit <= 0) {
      console.log(`  skip ${row.t.name}`);
      continue;
    }
    const next = row.target;
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.p.id)}`, {
        method: "PATCH",
        body: { balance_cents: next, updated_at: new Date().toISOString() },
      });
    } catch {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.p.id)}`, {
        method: "PATCH",
        body: { balance_cents: next },
      });
    }
    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        body: {
          user_id: row.p.id,
          type: "balance_correction",
          amount_cents: -row.debit,
          balance_after_cents: next,
          metadata: {
            reason: "clawback_injecao_saldo_auditoria_2026-07-22",
            suggested_cents: row.target,
            previous_balance_cents: row.bal,
            debit_cents: row.debit,
            name: row.t.name,
            fix: "vps-fix-saldo-suspeitos-v1",
          },
        },
      });
    } catch (e) {
      console.warn(`  wallet_tx falhou (${row.t.name}):`, e.message || e);
    }
    console.log(`  OK ${row.t.name}: ${money(row.bal)} → ${money(next)} (−${money(row.debit)})`);
  }

  console.log("\nOK — correções aplicadas");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
