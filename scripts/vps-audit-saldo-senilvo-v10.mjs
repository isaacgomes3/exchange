#!/usr/bin/env node
/**
 * Auditoria saldo Senilvo — reconstrói Apostador vs settles Kauno/Lech v10.
 *
 * Baseline informado pelo dono: ~R$ 856
 * Carteira atual (print): R$ 1.110,86
 *
 * Dry-run:
 *   node scripts/vps-audit-saldo-senilvo-v10.mjs
 * Clawback só do estorno heal +4,96 (se indevido):
 *   CLAWBACK_ESTORNO=1 FIX=1 node scripts/vps-audit-saldo-senilvo-v10.mjs
 *
 * Marker: vps-audit-saldo-senilvo-v10
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const CLAWBACK_ESTORNO =
  process.env.CLAWBACK_ESTORNO === "1" || process.env.CLAWBACK_ESTORNO === "true";
const TAG = "audit-saldo-senilvo-v10";
const NAME_HINT = /senilvo/i;
const BASELINE_CENTS = Math.round(Number(process.env.BASELINE || "856") * 100);

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

const contract = await import(
  pathToFileURL(path.resolve(__dirname, "lib/protection-flow-contract.mjs")).href
);
const { computeArbiShieldDeductionCents, settlementDeductionCents } = contract;

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
function metaOf(row) {
  const m = row && row.metadata;
  if (!m) return {};
  if (typeof m === "string") {
    try {
      return JSON.parse(m) || {};
    } catch {
      return {};
    }
  }
  return typeof m === "object" && m ? m : {};
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
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 600)}`);
  return data;
}

async function main() {
  console.log("==> Auditoria saldo Senilvo (v10)");
  console.log("    baseline informado:", money(BASELINE_CENTS));
  console.log("    FIX:", FIX ? "SIM" : "não");
  console.log("    CLAWBACK_ESTORNO:", CLAWBACK_ESTORNO ? "SIM" : "não");

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,deduction_balance_cents,demo_balance_cents&order=created_at.desc&limit=500`
  );
  const p = (Array.isArray(profiles) ? profiles : []).find((r) =>
    NAME_HINT.test(String(r.full_name || ""))
  );
  if (!p) {
    console.error("ERRO: perfil Senilvo não encontrado");
    process.exit(1);
  }

  const apostador = n(p.balance_cents) + n(p.reusable_balance_cents);
  console.log(`\n  perfil: ${p.full_name} (${String(p.id).slice(0, 8)})`);
  console.log(`  Apostador agora: ${money(apostador)}`);
  console.log(`  Reembolso:       ${money(p.deduction_balance_cents)}`);
  console.log(`  Locked:          ${money(p.locked_balance_cents)}`);

  const prots = await sb(
    `/rest/v1/protections?user_id=eq.${encodeURIComponent(
      p.id
    )}&select=*&order=created_at.desc&limit=50`
  );
  const list = Array.isArray(prots) ? prots : [];
  console.log(`\n  proteções: ${list.length}`);

  let expectDelta = 0;
  for (const row of list) {
    const st = String(row.status || "").toLowerCase();
    const amount = n(row.responsibility_cents || row.amount_cents);
    const fee =
      computeArbiShieldDeductionCents(row) || settlementDeductionCents(row) || 0;
    const meta = metaOf(row);
    const odd = meta.market_odd || row.odd || "?";
    console.log(
      `  · ${String(row.id).slice(0, 8)}  ${st}  stake=${money(
        amount
      )} odd=${odd} fee_v10=${money(fee)}`
    );
    if (st === "won_exchange") {
      expectDelta += amount - fee;
      console.log(`      Exchange → +stake −fee = ${money(amount - fee)}`);
    } else if (st === "lost_exchange" || st === "won_platform") {
      // ArbiShield: stake sai do Apostador e vai ao Reembolso (delta Apostador 0 após lock)
      console.log(`      ArbiShield → stake no Reembolso (Apostador já estava travado)`);
    }
  }

  const teorico = BASELINE_CENTS + expectDelta;
  console.log(`\n==== RECONSTRUÇÃO ====`);
  console.log(`  baseline:     ${money(BASELINE_CENTS)}`);
  console.log(`  Δ Exchange:   ${money(expectDelta)}  (soma stake−fee dos won_exchange)`);
  console.log(`  teórico:      ${money(teorico)}`);
  console.log(`  carteira:     ${money(apostador)}`);
  console.log(`  diferença:    ${money(apostador - teorico)}`);

  const txs = await sb(
    `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(
      p.id
    )}&select=id,type,amount_cents,ref,metadata,created_at&order=created_at.desc&limit=40`
  );
  const tlist = Array.isArray(txs) ? txs : [];
  console.log(`\n  últimas txs (${tlist.length}):`);
  let estornoHeal = 0;
  for (const t of tlist.slice(0, 20)) {
    const m = metaOf(t);
    const note = String(m.note || m.tag || "");
    console.log(
      `  · ${String(t.id).slice(0, 8)} ${t.type} ${n(t.amount_cents)} ${note.slice(0, 70)}`
    );
    if (
      t.type === "protection_refund" &&
      /estorna fee excedente|heal-pos-liquidar-alertas/i.test(note)
    ) {
      estornoHeal += n(t.amount_cents);
    }
  }
  console.log(`\n  estornos heal fee detectados: ${money(estornoHeal)}`);

  if (estornoHeal > 0) {
    console.log(
      `\n  Nota: o print R$ 1.110,86 = ~R$ 1.105,90 (pós-liquidar) + ${money(
        estornoHeal
      )} (estorno heal).`
    );
    console.log(
      "  Se a fee Kauno na carteira nunca chegou a R$ 43,48, esse estorno foi a mais."
    );
  }

  if (CLAWBACK_ESTORNO && estornoHeal > 0) {
    console.log(`\n  → clawback estorno heal ${money(estornoHeal)}`);
    if (!FIX) {
      console.log("  (dry-run) Exporte FIX=1 para debitar.");
      return;
    }
    const bal = n(p.balance_cents) + n(p.reusable_balance_cents);
    const take = Math.min(bal, estornoHeal);
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      body: {
        updated_at: new Date().toISOString(),
        balance_cents: bal - take,
        reusable_balance_cents: 0,
      },
    });
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: p.id,
        type: "protection_settlement",
        amount_cents: -take,
        ref: `senilvo-clawback-estorno-heal`,
        metadata: {
          tag: TAG,
          note: `${TAG}: remove estorno heal fee indevido (+${take} tinha voltado a mais)`,
          clawback_estorno_heal_cents: take,
        },
      },
    });
    console.log(`  OK debitado ${money(take)} → Apostador ~${money(bal - take)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
