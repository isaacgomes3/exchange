#!/usr/bin/env node
/**
 * Auditoria GLOBAL — clientes ATIVOS com o mesmo problema do Carlos:
 *  1) Buraco em balance_after (saldo_tx salta sem crédito no ledger)
 *  2) Estornos protection_refund duplicados (bug F5)
 *  3) Drift: balance_cents atual vs reconstrução com locks como débito
 *
 * Na VPS:
 *   node scripts/vps-audit-injecao-saldo-ativos.mjs
 *   FROM=2026-07-15 MIN_GAP_REAIS=50 node scripts/vps-audit-injecao-saldo-ativos.mjs
 *
 * Só relatório — não altera saldo.
 */
import fs from "node:fs";
import path from "node:path";

const FROM = String(process.env.FROM || "2026-07-15").trim();
const TO = String(process.env.TO || "").trim();
const MIN_GAP_REAIS = Number(process.env.MIN_GAP_REAIS || 50);
const MIN_GAP = Math.round(MIN_GAP_REAIS * 100);
const MIN_DRIFT_REAIS = Number(process.env.MIN_DRIFT_REAIS || 50);
const MIN_DRIFT = Math.round(MIN_DRIFT_REAIS * 100);
const TX_LIMIT = Math.min(2000, Number(process.env.TX_LIMIT || 500));
const PAGE = Math.min(1000, Number(process.env.PAGE_SIZE || 500));

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
function pad(s, w) {
  s = String(s ?? "");
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

const DEBIT_TYPES = new Set([
  "protection_lock",
  "anchor_lock",
  "protection_fee",
  "withdraw",
  "withdrawal",
  "admin_adjustment_debit",
]);

function signedAmount(t) {
  const raw = n(t.amount_cents);
  const ty = String(t.type || "").toLowerCase();
  if (DEBIT_TYPES.has(ty) && raw > 0) return -raw;
  return raw;
}

function periodBounds() {
  const fromIso = new Date(`${FROM}T00:00:00-03:00`).toISOString();
  const toIso = TO
    ? new Date(`${TO}T23:59:59.999-03:00`).toISOString()
    : new Date().toISOString();
  return { fromIso, toIso };
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 220)}`);
  return data;
}

async function fetchActiveProfiles() {
  const out = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents,demo_balance_cents,locked_balance_cents,updated_at&order=created_at.asc`,
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
      throw new Error(`profiles parse: ${text.slice(0, 160)}`);
    }
    if (!res.ok) throw new Error(`${res.status} profiles: ${text.slice(0, 200)}`);
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
    if (from > 50000) break;
  }
  return out.filter((p) => {
    const st = String(p.account_status || "").toLowerCase().trim();
    if (["blocked", "suspended", "banned", "inactive", "inativo", "rejected"].includes(st)) {
      return false;
    }
    // active / ativo / approved / ok / vazio / qualquer outro status operacional
    return true;
  });
}

async function fetchUserTx(userId, fromIso, toIso) {
  const gte = encodeURIComponent(fromIso);
  const lte = encodeURIComponent(toIso);
  const paths = [
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at,balance_after_cents&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=${TX_LIMIT}`,
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${gte}&created_at=lte.${lte}&order=created_at.asc&limit=${TX_LIMIT}`,
  ];
  for (const p of paths) {
    try {
      const rows = await sb(p);
      return Array.isArray(rows) ? rows : [];
    } catch {
      /* try next */
    }
  }
  return [];
}

async function fetchOpeningAfter(userId, fromIso) {
  const lt = encodeURIComponent(fromIso);
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?select=balance_after_cents,created_at,type&user_id=eq.${encodeURIComponent(userId)}&created_at=lt.${lt}&order=created_at.desc&limit=1`
    );
    const r = Array.isArray(rows) ? rows[0] : null;
    if (r && r.balance_after_cents != null) return n(r.balance_after_cents);
  } catch {
    /* */
  }
  return null;
}

function analyzeTxs(txs, openingHint, balanceCents) {
  const gaps = [];
  let flipped = 0;
  let hasAfter = false;

  // 1) Buracos só entre balance_after reais (não usa abertura retrocalculada)
  let prevAfter = null;
  let sinceLast = 0;
  for (const t of txs) {
    const raw = n(t.amount_cents);
    const amt = signedAmount(t);
    if (amt !== raw) flipped += 1;

    if (t.balance_after_cents != null) {
      hasAfter = true;
      const after = n(t.balance_after_cents);
      if (prevAfter != null) {
        const expected = prevAfter + sinceLast + amt;
        const gap = after - expected;
        if (Math.abs(gap) >= MIN_GAP) {
          gaps.push({
            when: t.created_at,
            type: t.type,
            gap,
            prevAfter,
            after,
            amt,
            sinceLast,
          });
        }
      }
      prevAfter = after;
      sinceLast = 0;
    } else {
      sinceLast += amt;
    }
  }

  const gapSum = gaps.reduce((a, g) => a + g.gap, 0);
  const gapPositive = gaps.reduce((a, g) => a + Math.max(0, g.gap), 0);

  // 2) Abertura: hint, senão 1º balance_after − movimento até ele
  let opening = openingHint;
  let openingSource = openingHint != null ? "balance_after anterior" : null;
  if (opening == null) {
    let acc = 0;
    for (const t of txs) {
      const amt = signedAmount(t);
      if (t.balance_after_cents != null) {
        opening = n(t.balance_after_cents) - acc - amt;
        openingSource = "retro do 1º balance_after";
        break;
      }
      acc += amt;
    }
  }
  if (opening == null) {
    opening = 0;
    openingSource = "zero (sem balance_after)";
  }

  let running = opening;
  for (const t of txs) running += signedAmount(t);

  // 3) Drift: preferir última âncora balance_after + movos depois
  let suggested = running;
  let drift = n(balanceCents) - running;
  if (prevAfter != null) {
    const fromLastAfter = prevAfter + sinceLast;
    // se o profile bate com a âncora, drift~0; se profile >> âncora, overcredit
    const driftAnchor = n(balanceCents) - fromLastAfter;
    // usa o maior sinal de problema
    if (Math.abs(driftAnchor) > Math.abs(drift)) {
      suggested = fromLastAfter;
      drift = driftAnchor;
    }
  }
  // Injeção nos buracos também conta como overcredit a corrigir
  const overcredit = Math.max(0, drift, gapPositive);

  // Estornos duplicados
  const refunds = txs.filter(
    (t) => String(t.type || "").toLowerCase() === "protection_refund"
  );
  const byProt = new Map();
  for (const t of refunds) {
    const pid =
      (t.ref && String(t.ref)) ||
      (t.metadata && String(t.metadata.protection_id || "")) ||
      "";
    if (!pid) continue;
    if (!byProt.has(pid)) byProt.set(pid, []);
    byProt.get(pid).push(t);
  }
  let refundExcess = 0;
  let dupProts = 0;
  for (const [, list] of byProt) {
    if (list.length <= 1) continue;
    const sum = list.reduce((a, t) => a + n(t.amount_cents), 0);
    const once = Math.max(...list.map((t) => n(t.amount_cents)));
    const excess = Math.max(0, sum - once);
    if (excess > 0) {
      dupProts += 1;
      refundExcess += excess;
    }
  }

  return {
    opening,
    openingSource,
    suggested,
    drift,
    overcredit,
    gapSum,
    gapPositive,
    gaps,
    flipped,
    hasAfter,
    refundExcess,
    dupProts,
    txCount: txs.length,
    lastAfter: prevAfter,
  };
}

async function main() {
  const { fromIso, toIso } = periodBounds();
  console.log("==> Auditoria GLOBAL — injeção / overcredit em clientes ATIVOS");
  console.log(`    período: ${FROM} → ${TO || "agora"}`);
  console.log(`    UTC: ${fromIso} → ${toIso}`);
  console.log(`    buraco mínimo: ${money(MIN_GAP)} · drift mínimo: ${money(MIN_DRIFT)}`);
  console.log("    (somente relatório — não altera saldo)");

  const profiles = await fetchActiveProfiles();
  console.log(`    profiles ativos: ${profiles.length}`);

  const suspects = [];
  let scanned = 0;
  let withTx = 0;

  for (const p of profiles) {
    scanned += 1;
    if (scanned % 25 === 0) {
      process.stderr.write(`    … ${scanned}/${profiles.length}\n`);
    }
    const txs = await fetchUserTx(p.id, fromIso, toIso);
    if (!txs.length) continue;
    withTx += 1;
    const openingHint = await fetchOpeningAfter(p.id, fromIso);
    const a = analyzeTxs(txs, openingHint, p.balance_cents);

    const materialGap = a.gapPositive >= MIN_GAP || a.gaps.some((g) => g.gap >= MIN_GAP);
    const materialDrift = a.drift >= MIN_DRIFT;
    const materialRefund = a.refundExcess >= MIN_DRIFT;
    const materialOver = a.overcredit >= MIN_DRIFT;

    if (!materialGap && !materialDrift && !materialRefund && !materialOver) continue;

    suspects.push({
      id: p.id,
      name: p.full_name || "—",
      status: p.account_status || "—",
      balance: n(p.balance_cents),
      reusable: n(p.reusable_balance_cents),
      locked: n(p.locked_balance_cents),
      ...a,
      score: a.overcredit + a.refundExcess + Math.max(0, a.gapPositive),
    });
  }

  suspects.sort((a, b) => b.score - a.score);

  console.log(`\n==> Escaneados: ${scanned} · com tx no período: ${withTx}`);
  console.log(`==> Suspeitos: ${suspects.length}`);

  if (!suspects.length) {
    console.log("  nenhum cliente operacional com buraco/drift/estorno duplicado material");
    console.log("OK");
    return;
  }

  console.log("\n==> LISTA PARA CORRIGIR (ordenado por overcredit)");
  console.log(
    pad("nome", 28) +
      pad("saldo atual", 14) +
      pad("sugerido", 14) +
      pad("corrigir", 14) +
      pad("buracos+", 14) +
      pad("F5", 12) +
      "id"
  );
  console.log("-".repeat(120));

  for (const s of suspects) {
    const corrigir = Math.max(s.overcredit, s.gapPositive, s.refundExcess);
    console.log(
      pad(String(s.name).slice(0, 26), 28) +
        pad(money(s.balance), 14) +
        pad(money(s.suggested), 14) +
        pad(money(corrigir), 14) +
        pad(money(s.gapPositive), 14) +
        pad(money(s.refundExcess), 12) +
        String(s.id).slice(0, 8)
    );
  }

  console.log("\n==> Detalhe dos buracos (top 25)");
  for (const s of suspects.slice(0, 25)) {
    const corrigir = Math.max(s.overcredit, s.gapPositive, s.refundExcess);
    console.log(
      `\n  ${s.name}  (${s.id})  status=${s.status}\n  saldo ${money(s.balance)} · sugerido ${money(s.suggested)} · CORRIGIR ${money(corrigir)} · F5 ${money(s.refundExcess)} (${s.dupProts} prot.) · locks sinal+ ${s.flipped}`
    );
    if (!s.gaps.length) {
      console.log("    (sem buraco balance_after ≥ limiar)");
      continue;
    }
    for (const g of s.gaps.slice(0, 8)) {
      console.log(
        `    ${String(g.when).replace("T", " ").slice(0, 19)}  ${pad(g.type, 22)} buraco ${money(g.gap)}  (${money(g.prevAfter)} + ${money(g.amt)} → gravado ${money(g.after)})`
      );
    }
    if (s.gaps.length > 8) console.log(`    … +${s.gaps.length - 8} buracos`);
  }

  const totCorrigir = suspects.reduce(
    (a, s) => a + Math.max(s.overcredit, s.gapPositive, s.refundExcess),
    0
  );
  const totGap = suspects.reduce((a, s) => a + s.gapPositive, 0);
  const totF5 = suspects.reduce((a, s) => a + s.refundExcess, 0);
  console.log("\n==> Totais (suspeitos)");
  console.log(`  contas a corrigir: ${suspects.length}`);
  console.log(`  soma a debitar (max overcredit/buraco/F5): ${money(totCorrigir)}`);
  console.log(`  soma buracos positivos: ${money(totGap)}`);
  console.log(`  soma F5 excess: ${money(totF5)}`);
  console.log(
    "\n  Cronologia: FROM=2026-07-15 ID_PREFIX=........ node /opt/arbishield/scripts/vps-saldo-cronologia.mjs"
  );
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
