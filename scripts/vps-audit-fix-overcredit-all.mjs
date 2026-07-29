#!/usr/bin/env node
/**
 * Auditoria GLOBAL de estornos duplicados (bug F5 / contest_list).
 * Varre todas as wallet_transactions protection_refund e corrige saldos.
 *
 * Na VPS:
 *   node scripts/vps-audit-fix-overcredit-all.mjs           # só relatório
 *   FIX=1 node scripts/vps-audit-fix-overcredit-all.mjs      # debita overcredit
 *   HEAL_CANCEL=1 node ...                                   # cancela review_odd de cancelamento sem re-creditar
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const HEAL_CANCEL =
  process.env.HEAL_CANCEL === "1" || process.env.HEAL_CANCEL === "true";
const PAGE = Math.min(1000, Number(process.env.PAGE_SIZE || 1000));

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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 220)}`);
  return data;
}

async function fetchAllRefunds() {
  const out = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/wallet_transactions?type=eq.protection_refund&select=id,user_id,amount_cents,ref,metadata,created_at&order=created_at.asc`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Range: `${from}-${to}`,
          Prefer: "count=exact",
        },
      }
    );
    const text = await res.text();
    let rows;
    try {
      rows = text ? JSON.parse(text) : [];
    } catch {
      throw new Error(`refund page parse: ${text.slice(0, 160)}`);
    }
    if (!res.ok) throw new Error(`${res.status} refunds: ${text.slice(0, 200)}`);
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
    if (from > 200000) break;
  }
  return out;
}

function protKey(t) {
  if (t.ref) return String(t.ref);
  if (t.metadata && t.metadata.protection_id) return String(t.metadata.protection_id);
  return "";
}

async function main() {
  console.log("==> Auditoria GLOBAL overcredit (protection_refund duplicado)");
  console.log("    SUPABASE_URL:", SUPABASE_URL);
  console.log("    FIX:", FIX ? "SIM (vai debitar)" : "não (só relatório)");
  console.log("    HEAL_CANCEL:", HEAL_CANCEL ? "SIM" : "não");

  const refunds = await fetchAllRefunds();
  console.log(`    refunds carregados: ${refunds.length}`);

  const byProt = new Map();
  for (const t of refunds) {
    const pid = protKey(t);
    if (!pid) continue;
    if (!byProt.has(pid)) byProt.set(pid, []);
    byProt.get(pid).push(t);
  }

  /** userId -> excess cents */
  const excessByUser = new Map();
  const details = [];

  for (const [pid, list] of byProt) {
    if (list.length <= 1) continue;
    const sum = list.reduce((a, t) => a + n(t.amount_cents), 0);
    const once = Math.max(...list.map((t) => n(t.amount_cents)));
    const excess = Math.max(0, sum - once);
    if (excess <= 0) continue;
    const userId = list[0].user_id;
    if (!userId) continue;
    excessByUser.set(userId, (excessByUser.get(userId) || 0) + excess);
    details.push({
      protectionId: pid,
      userId,
      count: list.length,
      sum,
      once,
      excess,
    });
  }

  console.log(`\n==> Proteções com estorno duplicado: ${details.length}`);
  for (const d of details.slice(0, 50)) {
    console.log(
      `  ${d.protectionId}  user=${d.userId}  ${d.count}x  excess=${money(d.excess)}`
    );
  }
  if (details.length > 50) console.log(`  … +${details.length - 50}`);

  console.log(`\n==> Contas afetadas: ${excessByUser.size}`);
  let totalExcess = 0;
  for (const [uid, excess] of excessByUser) {
    totalExcess += excess;
    const prof = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents&id=eq.${encodeURIComponent(uid)}&limit=1`
    );
    const p = Array.isArray(prof) ? prof[0] : null;
    const bal = n(p?.balance_cents);
    const next = Math.max(0, bal - excess);
    console.log(
      `  ${uid}  ${(p?.full_name || "—").slice(0, 28).padEnd(28)}  bal=${money(bal)}  excess=${money(excess)}  → ${money(next)}`
    );
  }
  console.log(`\n  TOTAL a debitar: ${money(totalExcess)}`);

  if (FIX && totalExcess > 0) {
    console.log("\n==> Aplicando FIX…");
    for (const [uid, excess] of excessByUser) {
      const prof = await sb(
        `/rest/v1/profiles?select=id,balance_cents&id=eq.${encodeURIComponent(uid)}&limit=1`
      );
      const p = Array.isArray(prof) ? prof[0] : null;
      if (!p) continue;
      const next = Math.max(0, n(p.balance_cents) - excess);
      try {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, {
          method: "PATCH",
          body: { balance_cents: next, updated_at: new Date().toISOString() },
        });
      } catch {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, {
          method: "PATCH",
          body: { balance_cents: next },
        });
      }
      try {
        await sb("/rest/v1/wallet_transactions", {
          method: "POST",
          body: {
            user_id: uid,
            type: "balance_correction",
            amount_cents: -excess,
            metadata: {
              reason: "clawback_duplicate_protection_refund_f5_global",
              excess_cents: excess,
            },
          },
        });
      } catch {
        /* */
      }
      console.log(`  OK ${uid} → ${money(next)}`);
    }
  } else if (totalExcess > 0) {
    console.log("\n  Para corrigir TODAS as contas:");
    console.log("  FIX=1 node scripts/vps-audit-fix-overcredit-all.mjs");
  }

  if (HEAL_CANCEL) {
    console.log("\n==> HEAL_CANCEL: marcar cancelamentos review_odd como cancelled (SEM creditar)");
    for (const table of ["protections", "back_protections"]) {
      const rows = await sb(
        `/rest/v1/${table}?select=id,user_id,status,metadata,amount_cents&status=eq.review_odd&limit=500`
      );
      let healed = 0;
      for (const r of Array.isArray(rows) ? rows : []) {
        const meta =
          (r.metadata && r.metadata.contestation) ||
          (r.metadata && r.metadata.calculations && r.metadata.calculations.contestation) ||
          {};
        if (String(meta.type || "").toLowerCase() !== "cancellation") continue;
        try {
          await sb(
            `/rest/v1/${table}?id=eq.${encodeURIComponent(r.id)}&status=eq.review_odd`,
            {
              method: "PATCH",
              body: {
                status: "cancelled",
                settled_at: new Date().toISOString(),
                result: "cancelled_refund",
              },
            }
          );
          healed += 1;
        } catch (e) {
          console.warn(`  falha ${table}/${r.id}:`, e.message || e);
        }
      }
      console.log(`  ${table}: ${healed} cancelamento(s) fechados sem crédito`);
    }
  }

  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
