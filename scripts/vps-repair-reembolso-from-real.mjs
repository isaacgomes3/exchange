#!/usr/bin/env node
/**
 * Reparo: créditos de Bateu ArbiShield que foram para Saldo Real
 * devem ir para Saldo Reembolso (deduction_balance_cents).
 *
 * Relatório:
 *   NAME="CARLOS ROBERTO" node scripts/vps-repair-reembolso-from-real.mjs
 * Aplicar:
 *   NAME="CARLOS ROBERTO" FIX=1 node scripts/vps-repair-reembolso-from-real.mjs
 *
 * Marker: vps-repair-reembolso-from-real-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(process.env.NAME || "").trim();
const USER_ID = String(process.env.USER_ID || "").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "").trim().toLowerCase();
const MATCH_HINT = String(process.env.MATCH_HINT || "").trim(); // ex.: KuPS

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
if (!USER_ID && !ID_PREFIX && !NAME) {
  console.error('Informe USER_ID=, ID_PREFIX= ou NAME="CARLOS ROBERTO"');
  process.exit(1);
}

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  return Math.max(0, Math.round(Number(v || 0)));
}
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
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
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  }
  return data;
}

function isArbiWin(row) {
  const st = String(row.status || "").toLowerCase();
  const out = String(row.settled_outcome || "").toLowerCase();
  if (out === "arbishield" || out === "lost_exchange") return true;
  if (st === "won_platform" || st === "lost_exchange") return true;
  // UI "REEMBOLSO" / labels legadas
  if (st === "refunded" && out === "arbishield") return true;
  return false;
}

async function resolveUser() {
  if (USER_ID) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(USER_ID)}`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  if (ID_PREFIX) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  const first = NAME.split(/\s+/)[0];
  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents&full_name=ilike.*${encodeURIComponent(first)}*&limit=50`
  );
  const want = norm(NAME);
  const list = (Array.isArray(rows) ? rows : []).filter((r) => {
    const nme = norm(r.full_name);
    return nme === want || nme.includes(want) || want.includes(nme);
  });
  if (!list.length) {
    console.error("perfil não encontrado:", NAME || USER_ID);
    process.exit(2);
  }
  list.sort(
    (a, b) =>
      Number(norm(b.full_name) === want) - Number(norm(a.full_name) === want) ||
      String(b.full_name || "").length - String(a.full_name || "").length
  );
  if (list.length > 1) {
    console.log("Vários matches:");
    list.forEach((r) =>
      console.log(
        `  ${r.id}  ${r.full_name}  real=${money(r.balance_cents)}  reemb=${money(r.deduction_balance_cents)}`
      )
    );
  }
  return list[0];
}

async function loadArbiWins(userId) {
  const select =
    "id,status,amount_cents,responsibility_cents,settled_outcome,settled_at,match_id,updated_at,created_at";
  const [lays, backs] = await Promise.all([
    sb(
      `/rest/v1/protections?select=${select}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1000`
    ).catch(() => []),
    sb(
      `/rest/v1/back_protections?select=${select}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1000`
    ).catch(() => []),
  ]);
  const all = [
    ...(Array.isArray(lays) ? lays : []).map((r) => ({ ...r, _table: "protections" })),
    ...(Array.isArray(backs) ? backs : []).map((r) => ({
      ...r,
      _table: "back_protections",
    })),
  ].filter(isArbiWin);

  // Enrich match names (optional filter)
  const matchIds = [...new Set(all.map((r) => r.match_id).filter(Boolean))];
  const matchMap = new Map();
  for (const id of matchIds.slice(0, 80)) {
    try {
      const rows = await sb(
        `/rest/v1/matches?select=id,home_team,away_team&id=eq.${encodeURIComponent(id)}&limit=1`
      );
      if (Array.isArray(rows) && rows[0]) matchMap.set(id, rows[0]);
    } catch {
      /* */
    }
  }

  return all
    .map((r) => {
      const m = matchMap.get(r.match_id) || {};
      const label = [m.home_team, m.away_team].filter(Boolean).join(" x ");
      return {
        ...r,
        matchLabel: label || r.match_id || "—",
        creditCents: n(r.responsibility_cents || r.amount_cents),
      };
    })
    .filter((r) => {
      if (!MATCH_HINT) return true;
      return norm(r.matchLabel).includes(norm(MATCH_HINT));
    });
}

async function main() {
  console.log("==> Reparo Real → Saldo Reembolso");
  console.log("    marker: vps-repair-reembolso-from-real-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (dry-run)");

  const p = await resolveUser();
  console.log("    user:", p.id, p.full_name);

  const wins = await loadArbiWins(p.id);
  const expected = wins.reduce((a, r) => a + r.creditCents, 0);

  const wds = await sb(
    `/rest/v1/withdrawals?select=amount_cents,status,metadata&user_id=eq.${encodeURIComponent(p.id)}&limit=200`
  ).catch(() => []);
  let wdReemb = 0;
  for (const w of Array.isArray(wds) ? wds : []) {
    const st = String(w.status || "").toLowerCase();
    if (["rejected", "cancelled", "canceled"].includes(st)) continue;
    const origin = String(
      metaOf(w).origin || metaOf(w).label || metaOf(w).request_type || ""
    ).toUpperCase();
    if (
      origin.includes("REEMBOLSO") ||
      origin.includes("DEDUCTION") ||
      origin.includes("DEDUCAO")
    ) {
      wdReemb += n(w.amount_cents);
    }
  }

  // Transferências Reembolso→Desafio já saíram do bucket
  const xfers = await sb(
    `/rest/v1/wallet_transactions?select=amount_cents,type,metadata&user_id=eq.${encodeURIComponent(p.id)}&type=eq.internal_transfer&limit=500`
  ).catch(() => []);
  let xferOut = 0;
  for (const t of Array.isArray(xfers) ? xfers : []) {
    const m = metaOf(t);
    if (String(m.from_bucket || "") === "deduction_balance_cents") {
      xferOut += n(t.amount_cents);
    }
  }

  const deduction = n(p.deduction_balance_cents);
  const balance = n(p.balance_cents);
  const reusable = n(p.reusable_balance_cents);
  // Quanto deveria estar no Reembolso agora (créditos Arbi − saques − xfers)
  const targetDeduction = Math.max(0, expected - wdReemb - xferOut);
  const shortfall = Math.max(0, targetDeduction - deduction);
  const move = Math.min(shortfall, balance);

  console.log("\n==> Proteções Bateu ArbiShield / REEMBOLSO:", wins.length);
  wins.slice(0, 20).forEach((r) => {
    console.log(
      `  ${r._table} ${String(r.id).slice(0, 8)}  ${r.matchLabel}  ${money(r.creditCents)}  ${r.status}/${r.settled_outcome || ""}`
    );
  });
  if (wins.length > 20) console.log(`  ... +${wins.length - 20} mais`);

  console.log("\n==> Contas");
  console.log("    esperado (soma Arbi):", money(expected));
  console.log("    saques Reembolso:    ", money(wdReemb));
  console.log("    xfer → Desafio:      ", money(xferOut));
  console.log("    alvo Reembolso:      ", money(targetDeduction));
  console.log("    Reembolso atual:     ", money(deduction));
  console.log("    Real atual:          ", money(balance), "(+ reusable", money(reusable) + ")");
  console.log("    a mover Real→Reemb:  ", money(move));

  if (move <= 0) {
    if (shortfall > 0 && balance <= 0) {
      console.log(
        "\nFalta Reembolso mas Saldo Real zerado — não há de onde debitar."
      );
    } else {
      console.log("\nNada a mover (Reembolso já cobre o esperado, ou sem wins).");
    }
    return;
  }

  console.log("\n==> DEPOIS");
  console.log("    Real:     ", money(balance - move));
  console.log("    Reembolso:", money(deduction + move));

  if (!FIX) {
    console.log("\n(dry-run) Para aplicar:");
    console.log(
      `  NAME="${p.full_name || NAME}" FIX=1 node scripts/vps-repair-reembolso-from-real.mjs`
    );
    return;
  }

  // Idempotência: mesma movimentação nos últimos 30 min
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const recent = await sb(
    `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(p.id)}` +
      `&type=eq.admin_adjustment&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=20`
  ).catch(() => []);
  const dup = (Array.isArray(recent) ? recent : []).some((t) => {
    const m = metaOf(t);
    return (
      m.kind === "repair_reembolso_from_real_v1" &&
      n(m.amount_cents) === move
    );
  });
  if (dup) {
    console.log("Correção idêntica recente — abortando.");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: balance - move,
      deduction_balance_cents: deduction + move,
      updated_at: new Date().toISOString(),
    },
  });

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: p.id,
        type: "admin_adjustment",
        amount_cents: 0,
        ref: p.id,
        metadata: {
          kind: "repair_reembolso_from_real_v1",
          fix: "vps-repair-reembolso-from-real-v1",
          from_bucket: "balance_cents",
          to_bucket: "deduction_balance_cents",
          amount_cents: move,
          expected_arbi_cents: expected,
          target_deduction_cents: targetDeduction,
          wins_count: wins.length,
          name: p.full_name,
          reason:
            "Settle legado creditou Bateu ArbiShield no Real — move para Saldo Reembolso",
        },
      },
    });
  } catch (e) {
    console.warn("wallet_transactions:", e instanceof Error ? e.message : e);
  }

  console.log("✓ aplicado — Contro+F5 em /app-carteira.html");
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
